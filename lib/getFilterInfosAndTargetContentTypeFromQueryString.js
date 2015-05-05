var Stream = require('stream'),
    _ = require('underscore'),
    gm = require('gm'),
    sharp,
    isOperationByEngineNameAndName = {gm: {}},
    filterConstructorByOperationName = {},
    errors = require('./errors');

['PngQuant', 'PngCrush', 'OptiPng', 'JpegTran', 'Inkscape', 'SvgFilter'].forEach(function (constructorName) {
    try {
        filterConstructorByOperationName[constructorName.toLowerCase()] = require(constructorName.toLowerCase());
    } catch (e) {
        // SvgFilter might fail because of failed contextify installation on windows.
        // Dependency chain to contextify: svgfilter --> assetgraph --> jsdom --> contextify
    }
});

Object.keys(gm.prototype).forEach(function (propertyName) {
    if (!/^_|^(?:emit|.*Listeners?|on|once|size|orientation|format|depth|color|res|filesize|identity|write|stream)$/.test(propertyName) &&
        typeof gm.prototype[propertyName] === 'function') {
        isOperationByEngineNameAndName.gm[propertyName] = true;
    }
});

// For compatibility with the sharp format switchers (minus webp, which graphicsmagick doesn't support).
// Consider adding more from this list: gm convert -list format
['jpeg', 'png'].forEach(function (formatName) {
    isOperationByEngineNameAndName.gm[formatName] = true;
});

try {
    sharp = require('sharp');
} catch (e) {}

if (sharp) {
    isOperationByEngineNameAndName.sharp = {};
    ['resize', 'extract', 'sequentialRead', 'crop', 'max', 'background', 'embed', 'flatten', 'rotate', 'flip', 'flop', 'withoutEnlargement', 'sharpen', 'interpolateWith', 'gamma', 'grayscale', 'greyscale', 'jpeg', 'png', 'webp', 'quality', 'progressive', 'withMetadata', 'compressionLevel'].forEach(function (sharpOperationName) {
        isOperationByEngineNameAndName.sharp[sharpOperationName] = true;
    });
}

var engineNamesByOperationName = {};

Object.keys(isOperationByEngineNameAndName).forEach(function (engineName) {
    Object.keys(isOperationByEngineNameAndName[engineName]).forEach(function (operationName) {
        (engineNamesByOperationName[operationName] = engineNamesByOperationName[operationName] || []).push(engineName);
    });
});

module.exports = function getFilterInfosAndTargetContentTypeFromQueryString(queryString, options) {
    options = options || {};
    var filters = options.filters || {},
        filterInfos = [],
        defaultEngineName = options.defaultEngineName || (sharp && 'sharp') || 'gm',
        currentEngineName,
        operations = [],
        operationNames = [],
        usedQueryStringFragments = [],
        leftOverQueryStringFragments = [],
        targetContentType;

    function checkSharpOrGmOperation(operation) {
        if (operation.name === 'resize' && typeof options.maxOutputPixels === 'number' && operation.args.length >= 2 && operation.args[0] * operation.args[1] > options.maxOutputPixels) {
            // FIXME: Realizing that we're going over the limit when only one resize operand is given would require knowing the metadata.
            // It's a big wtf that the maxOutputPixels option is only enforced some of the time.
            throw new errors.OutputDimensionsExceeded('resize: Target dimensions of ' + operation.args[0] + 'x' + operation.args[1] + ' exceed maxOutputPixels (' + options.maxOutputPixels + ')');
        }
    }

    function flushOperations() {
        if (operations.length > 0) {
            if (currentEngineName === 'sharp') {
                var sharpOperationsForThisInstance = [].concat(operations);
                operationNames.push('sharp');
                filterInfos.push({
                    operationName: 'sharp',
                    usedQueryStringFragments: operations.map(function (operation) {
                        return operation.usedQueryStringFragment;
                    }),
                    create: function () {
                        if (options.maxInputPixels) {
                            sharpOperationsForThisInstance.unshift({name: 'limitInputPixels', args: [options.maxInputPixels]});
                        }
                        return sharpOperationsForThisInstance.reduce(function (sharpInstance, operation) {
                            checkSharpOrGmOperation(operation);
                            return sharpInstance[operation.name].apply(sharpInstance, operation.args);
                        }, sharp());
                    }
                });
            } else if (currentEngineName === 'gm') {
                var gmOperationsForThisInstance = [].concat(operations);
                operationNames.push('gm');
                filterInfos.push({
                    operationName: 'gm',
                    usedQueryStringFragments: operations.map(function (operation) {
                        return operation.usedQueryStringFragment;
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
                                var seenData = false,
                                    hasEnded = false,
                                    gmInstance = gm(readStream);
                                if (options.maxInputPixels) {
                                    gmInstance.limit('pixels', options.maxInputPixels);
                                }
                                gmOperationsForThisInstance.reduce(function (gmInstance, gmOperation) {
                                    checkSharpOrGmOperation(gmOperation);
                                    if (!gmInstance[gmOperation.name]) {
                                        gmOperation = _.extend({}, gmOperation);
                                        gmOperation.args.unshift(gmOperation.name);
                                        gmOperation.name = 'setFormat';
                                    }
                                    return gmInstance[gmOperation.name].apply(gmInstance, gmOperation.args);
                                }, gmInstance).stream(function (err, stdout, stderr) {
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
            } else {
                throw new Error('Internal error');
            }
            operations = [];
        }
        currentEngineName = undefined;
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

            var filterInfo;
            if (filters[operationName]) {
                flushOperations();
                filterInfo = filters[operationName](operationArgs, {
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
                    operationNames.push(operationName);
                    usedQueryStringFragments.push(keyValuePair);
                } else {
                    leftOverQueryStringFragments.push(keyValuePair);
                }
            } else if (isOperationByEngineNameAndName[operationName]) {
                usedQueryStringFragments.push(keyValuePair);
                flushOperations();
                defaultEngineName = operationName;
            } else if (engineNamesByOperationName[operationName]) {
                // Check if at least one of the engines supporting this operation is allowed
                var candidateEngineNames = engineNamesByOperationName[operationName].filter(function (engineName) {
                    return filters[engineName] !== false;
                });
                if (candidateEngineNames.length > 0) {
                    if (currentEngineName && !isOperationByEngineNameAndName[currentEngineName]) {
                        flushOperations();
                    }

                    if (!currentEngineName || candidateEngineNames.indexOf(currentEngineName) === -1) {
                        if (candidateEngineNames.indexOf(defaultEngineName) !== -1) {
                            currentEngineName = defaultEngineName;
                        } else {
                            currentEngineName = candidateEngineNames[0];
                        }
                    }
                    if (operationName === 'setFormat' && operationArgs.length > 0) {
                        var targetFormat = operationArgs[0].toLowerCase();
                        if (targetFormat === 'jpg') {
                            targetFormat = 'jpeg';
                        }
                        targetContentType = 'image/' + targetFormat;
                    } else if (operationName === 'jpeg' || operationName === 'png' || operationName === 'webp') {
                        targetContentType = 'image/' + operationName;
                    }
                    operations.push({name: operationName, args: operationArgs, usedQueryStringFragment: keyValuePair});
                    usedQueryStringFragments.push(keyValuePair);
                }
            } else {
                var operationNameLowerCase = operationName.toLowerCase(),
                    FilterConstructor = filterConstructorByOperationName[operationNameLowerCase];
                if (FilterConstructor && filters[operationNameLowerCase] !== false) {
                    operationNames.push(operationNameLowerCase);
                    flushOperations();
                    if (operationNameLowerCase === 'svgfilter' && options.rootPath && options.sourceFilePath) {
                        operationArgs.push('--root', 'file://' + options.rootPath, '--url', 'file://' + options.sourceFilePath);
                    }
                    filterInfo = {
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
    flushOperations();

    return {
        targetContentType: targetContentType,
        operationNames: operationNames,
        filterInfos: filterInfos,
        usedQueryStringFragments: usedQueryStringFragments,
        leftOverQueryStringFragments: leftOverQueryStringFragments
    };
};
