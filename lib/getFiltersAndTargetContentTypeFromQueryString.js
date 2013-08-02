var Stream = require('stream'),
    gm = require('gm'),
    isGmOperationByName = {},
    filterConstructorByOperationName = {};

['PngQuant', 'PngCrush', 'OptiPng', 'JpegTran', 'Inkscape', 'SvgFilter'].forEach(function (constructorName) {
    try {
        filterConstructorByOperationName[constructorName.toLowerCase()] = require(constructorName.toLowerCase());
    } catch (e) {
        // SvgFilter might fail because of failed contextify installation on windows.
        // Dependency chain to contextify: svgfilter --> assetgraph --> jsdom --> contextify
    }
});

Object.keys(gm.prototype).forEach(function (propertyName) {
    if (!/^_|^(?:size|orientation|format|depth|color|res|filesize|identity|write|stream)$/.test(propertyName) &&
        typeof gm.prototype[propertyName] === 'function') {
        isGmOperationByName[propertyName] = true;
    }
});

module.exports = function getFiltersAndTargetContentTypeFromQueryString(queryString, rootPath, sourceFilePath) {
    var filters = [],
        gmOperations = [],
        operationNames = [],
        usedQueryStringFragments = [],
        leftOverQueryStringFragments = [],
        targetContentType;

    function flushGmOperations() {
        if (gmOperations.length > 0) {
            // For some reason the gm module doesn't expose itself as a readable/writable stream,
            // so we need to wrap it into one:

            var readStream = new Stream();
            readStream.readable = true;

            var readWriteStream = new Stream();
            readWriteStream.readable = readWriteStream.writable = true;
            readWriteStream.write = function (chunk) {
                readStream.emit('data', chunk);
            };
            readWriteStream.end = function (chunk) {
                if (chunk) {
                    readWriteStream.write(chunk);
                }
                readStream.emit('end');
            };

            var gmInstance = gm(readStream);
            gmOperations.forEach(function (gmOperation) {
                gmInstance = gmInstance[gmOperation.name].apply(gmInstance, gmOperation.args);
            });
            var seenData = false,
                hasEnded = false;
            gmInstance.stream(function (err, stdout, stderr) {
                if (err) {
                    hasEnded = true;
                    return readWriteStream.emit('error', err);
                }
                stdout.on('data', function (chunk) {
                    seenData = true;
                    readWriteStream.emit('data', chunk);
                }).on('end', function () {
                    if (!hasEnded) {
                        if (seenData) {
                            readWriteStream.emit('end');
                        } else {
                            readWriteStream.emit('error', new Error('The gm stream ended without emitting any data'));
                        }
                        hasEnded = true;
                    }
                });
            });
            operationNames.push('gm');
            filters.push(readWriteStream);
        }
        gmOperations = [];
    }

    queryString.split('&').forEach(function (keyValuePair) {
        var matchKeyValuePair = keyValuePair.match(/^([^=]+)(?:=(.*))?/);
        if (matchKeyValuePair) {
            var operationName = decodeURIComponent(matchKeyValuePair[1]),
                // Split by non-URL encoded comma or plus:
                operationArgs = matchKeyValuePair[2] ? matchKeyValuePair[2].split(/[\+,]/).map(function (arg) {
                    arg = decodeURIComponent(arg);
                    return /^\d+$/.test(arg) ? parseInt(arg, 10) : arg;
                }) : [];

            if (isGmOperationByName[operationName]) {
                if (operationName === 'setFormat' && operationArgs.length > 0) {
                    var targetFormat = operationArgs[0].toLowerCase();
                    if (targetFormat === 'jpg') {
                        targetFormat = 'jpeg';
                    }
                    targetContentType = "image/" + targetFormat;
                }
                gmOperations.push({name: operationName, args: operationArgs});
                usedQueryStringFragments.push(keyValuePair);
            } else {
                var operationNameLowerCase = operationName.toLowerCase(),
                    FilterConstructor = filterConstructorByOperationName[operationNameLowerCase];
                if (FilterConstructor) {
                    operationNames.push(operationNameLowerCase);
                    flushGmOperations();
                    if (operationNameLowerCase === 'svgfilter') {
                        operationArgs.push('--root', 'file://' + rootPath, '--url', 'file://' + sourceFilePath);
                    }
                    var filter = new FilterConstructor(operationArgs);
                    filters.push(filter);
                    usedQueryStringFragments.push(keyValuePair);
                    if (operationNameLowerCase === 'inkscape') {
                        targetContentType = 'image/' + filter.outputFormat;
                    }
                } else {
                    leftOverQueryStringFragments.push(keyValuePair);
                }
            }
        }
    });
    flushGmOperations();

    return {
        targetContentType: targetContentType,
        operationNames: operationNames,
        filters: filters,
        usedQueryStringFragments: usedQueryStringFragments,
        leftOverQueryStringFragments: leftOverQueryStringFragments
    };
};
