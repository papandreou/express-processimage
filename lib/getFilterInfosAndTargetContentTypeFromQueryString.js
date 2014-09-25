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

module.exports = function getFilterInfosAndTargetContentTypeFromQueryString(queryString, options) {
    options = options || {};
    var filters = options.filters || {},
        filterInfos = [],
        gmOperations = [],
        operationNames = [],
        usedQueryStringFragments = [],
        leftOverQueryStringFragments = [],
        targetContentType;

    function flushGmOperations() {
        if (gmOperations.length > 0) {
            var gmOperationsForThisInstance = [].concat(gmOperations);
            operationNames.push('gm');
            filterInfos.push({
                operationName: 'gm',
                usedQueryStringFragments: gmOperations.map(function (gmOperation) {
                    return gmOperation.usedQueryStringFragment;
                }),
                create: function () {
                    // For some reason the gm module doesn't expose itself as a readable/writable stream,
                    // so we need to wrap it into one:

                    var readStream = new Stream();
                    readStream.readable = true;

                    var readWriteStream = new Stream();
                    readWriteStream.readable = readWriteStream.writable = true;
                    var spawned = false;

                    readWriteStream.write = function (chunk) {
                        if (!spawned) {
                            spawned = true;
                            var gmInstance = gm(readStream);
                            gmOperationsForThisInstance.forEach(function (gmOperation) {
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
                        }
                        readStream.emit('data', chunk);
                    };
                    readWriteStream.end = function (chunk) {
                        if (chunk) {
                            readWriteStream.write(chunk);
                        }
                        readStream.emit('end');
                    };
                    return readWriteStream;
                }
            });
            gmOperations = [];
        }
    }

    queryString.split('&').forEach(function (keyValuePair) {
        var matchKeyValuePair = keyValuePair.match(/^([^=]+)(?:=(.*))?/);
        if (matchKeyValuePair) {
            var operationName = decodeURIComponent(matchKeyValuePair[1]),
                // Split by non-URL encoded comma or plus:
                operationArgs = matchKeyValuePair[2] ? matchKeyValuePair[2].split(/[\+,]/).map(function (arg) {
                    arg = decodeURIComponent(arg);
                    if (/^\d+$/.test(arg)) {
                        return parseInt(arg, 10);
                    } else if (arg === 'true') {
                        return true;
                    } else if (arg === 'false') {
                        return false;
                    } else {
                        return arg;
                    }
                }) : [];

            if (filters[operationName]) {
                flushGmOperations();
                var filterInfo = filters[operationName](operationArgs, {
                    inputContentType: targetContentType,
                    numPreceedingFilters: filterInfos.length
                });
                if (filterInfo) {
                    filterInfo.usedQueryStringFragments = [keyValuePair];
                    filterInfo.operationName = operationName;
                    if (filterInfo.outputContentType) {
                        targetContentType = filterInfo.outputContentType;
                    }
                    filterInfos.push(filterInfo);
                    operationNames.push(operationNameLowerCase);
                    usedQueryStringFragments.push(keyValuePair);
                } else {
                    leftOverQueryStringFragments.push(keyValuePair);
                }
            } else if (isGmOperationByName[operationName] && filters.gm !== false) {
                if (operationName === 'setFormat' && operationArgs.length > 0) {
                    var targetFormat = operationArgs[0].toLowerCase();
                    if (targetFormat === 'jpg') {
                        targetFormat = 'jpeg';
                    }
                    targetContentType = 'image/' + targetFormat;
                }
                gmOperations.push({name: operationName, args: operationArgs, usedQueryStringFragment: keyValuePair});
                usedQueryStringFragments.push(keyValuePair);
            } else {
                var operationNameLowerCase = operationName.toLowerCase(),
                    FilterConstructor = filterConstructorByOperationName[operationNameLowerCase];
                if (FilterConstructor && filters[operationNameLowerCase] !== false) {
                    operationNames.push(operationNameLowerCase);
                    flushGmOperations();
                    if (operationNameLowerCase === 'svgfilter' && options.rootPath && options.sourceFilePath) {
                        operationArgs.push('--root', 'file://' + options.rootPath, '--url', 'file://' + options.sourceFilePath);
                    }
                    var filterInfo = {
                        create: function () {
                            return new FilterConstructor(operationArgs);
                        },
                        operationName: operationNameLowerCase,
                        usedQueryStringFragments: [keyValuePair]
                    };
                    filterInfos.push(filterInfo);
                    usedQueryStringFragments.push(keyValuePair);
                    if (operationNameLowerCase === 'inkscape') {
                        var filter = filterInfo.create();
                        filterInfo.create = function () {
                            return filter;
                        };
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
        filterInfos: filterInfos,
        usedQueryStringFragments: usedQueryStringFragments,
        leftOverQueryStringFragments: leftOverQueryStringFragments
    };
};
