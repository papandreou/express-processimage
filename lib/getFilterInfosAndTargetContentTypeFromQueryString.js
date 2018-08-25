/*global JSON*/
var Stream = require('stream');
var _ = require('underscore');
var gm = require('gm-papandreou');
var mime = require('mime');
var createAnimatedGifDetector = require('animated-gif-detector');
var exifReader = require('exif-reader-paras20xx');
var icc = require('icc');
var sharp;
var Gifsicle;
var isOperationByEngineNameAndName = { gm: {} };
var filterConstructorByOperationName = {};
var errors = require('./errors');

[
  'PngQuant',
  'PngCrush',
  'OptiPng',
  'JpegTran',
  'Inkscape',
  'SvgFilter'
].forEach(function(constructorName) {
  try {
    filterConstructorByOperationName[
      constructorName.toLowerCase()
    ] = require(constructorName.toLowerCase());
  } catch (e) {
    // SvgFilter might fail because of failed contextify installation on windows.
    // Dependency chain to contextify: svgfilter --> assetgraph --> jsdom --> contextify
  }
});

Object.keys(gm.prototype).forEach(function(propertyName) {
  if (
    !/^_|^(?:emit|.*Listeners?|on|once|size|orientation|format|depth|color|res|filesize|identity|write|stream)$/.test(
      propertyName
    ) &&
    typeof gm.prototype[propertyName] === 'function'
  ) {
    isOperationByEngineNameAndName.gm[propertyName] = true;
  }
});

function getMockFileNameForContentType(contentType) {
  if (contentType) {
    if (
      contentType === 'image/vnd.microsoft.icon' ||
      contentType === 'image/x-icon'
    ) {
      return '.ico';
    }
    return '.' + mime._extensions[contentType];
  }
}

// For compatibility with the sharp format switchers (minus webp, which graphicsmagick doesn't support).
// Consider adding more from this list: gm convert -list format
['jpeg', 'png'].forEach(function(formatName) {
  isOperationByEngineNameAndName.gm[formatName] = true;
});

isOperationByEngineNameAndName.gm.extract = true;

try {
  sharp = require('sharp');
} catch (e) {}

try {
  Gifsicle = require('gifsicle-stream');
} catch (e) {}

var sharpFormats = ['png', 'jpeg', 'webp'];
if (sharp) {
  isOperationByEngineNameAndName.sharp = {};
  [
    'resize',
    'extract',
    'sequentialRead',
    'crop',
    'max',
    'background',
    'embed',
    'flatten',
    'rotate',
    'flip',
    'flop',
    'withoutEnlargement',
    'ignoreAspectRatio',
    'sharpen',
    'interpolateWith',
    'gamma',
    'grayscale',
    'greyscale',
    'jpeg',
    'png',
    'webp',
    'quality',
    'progressive',
    'withMetadata',
    'compressionLevel',
    'setFormat'
  ].forEach(function(sharpOperationName) {
    isOperationByEngineNameAndName.sharp[sharpOperationName] = true;
  });
}

var engineNamesByOperationName = {};

Object.keys(isOperationByEngineNameAndName).forEach(function(engineName) {
  Object.keys(isOperationByEngineNameAndName[engineName]).forEach(function(
    operationName
  ) {
    (engineNamesByOperationName[operationName] =
      engineNamesByOperationName[operationName] || []).push(engineName);
  });
});

function isNumberWithin(num, min, max) {
  return typeof num === 'number' && num >= min && num <= max;
}

function isValidOperation(name, args) {
  var maxDimension = 16384;
  switch (name) {
    case 'crop':
      return (
        args.length === 1 &&
        /^(?:east|west|center|north(?:|west|east)|south(?:|west|east)|attention|entropy)$/.test(
          args[0]
        )
      );
    case 'rotate':
      return (
        args.length === 0 ||
        (args.length === 1 &&
          (args[0] === 0 ||
            args[0] === 90 ||
            args[0] === 180 ||
            args[0] === 270))
      );
    case 'resize':
      if (args.length === 1 || (args.length === 2 && args[1] === '')) {
        return isNumberWithin(args[0], 1, maxDimension);
      }
      if (args.length !== 2) {
        return false;
      }
      if (args[0] === '') {
        return isNumberWithin(args[1], 1, maxDimension);
      }
      return (
        isNumberWithin(args[0], 1, maxDimension) &&
        isNumberWithin(args[1], 1, maxDimension)
      );
    case 'extract':
      return (
        args.length === 4 &&
        isNumberWithin(args[0], 0, maxDimension - 1) &&
        isNumberWithin(args[1], 0, maxDimension - 1) &&
        isNumberWithin(args[2], 1, maxDimension) &&
        isNumberWithin(args[3], 1, maxDimension)
      );
    case 'interpolateWith':
      return (
        args.length === 1 &&
        /^(?:nearest|bilinear|vertexSplitQuadraticBasisSpline|bicubic|locallyBoundedBicubic|nohalo)$/.test(
          args[0]
        )
      );
    case 'background':
      return (
        args.length === 1 &&
        /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{9}|[0-9a-f]{12}|[0-9a-f]{4}|[0-9a-f]{8}|[0-9a-f]{6})$/i.test(
          args[0]
        )
      );
    case 'blur':
      return (
        args.length === 0 ||
        (args.length === 1 && isNumberWithin(args[0], 0.3, 1000))
      );
    case 'sharpen':
      return (
        args.length <= 3 &&
        (typeof args[0] === 'undefined' || typeof args[0] === 'number') &&
        (typeof args[1] === 'undefined' || typeof args[1] === 'number') &&
        (typeof args[2] === 'undefined' || typeof args[2] === 'number')
      );
    case 'threshold':
      return (
        args.length === 0 ||
        (args.length === 1 && isNumberWithin(args[0], 0, 255))
      );
    case 'gamma':
      return (
        args.length === 0 ||
        (args.length === 1 && isNumberWithin(args[0], 1, 3))
      );
    case 'quality':
      return args.length === 1 && isNumberWithin(args[0], 1, 100);
    case 'tile':
      return (
        args.length <= 2 &&
        (typeof args[0] === 'undefined' || isNumberWithin(args[0], 1, 8192)) &&
        (typeof args[1] === 'undefined' || isNumberWithin(args[0], 0, 8192))
      );
    case 'compressionLevel':
      return args.length === 1 && isNumberWithin(args[0], 0, 9);
    case 'png':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'withoutEnlargement':
    case 'progressive':
    case 'ignoreAspectRatio':
    case 'embed':
    case 'max':
    case 'min':
    case 'negate':
    case 'flatten':
    case 'flip':
    case 'flop':
    case 'grayscale':
    case 'greyscale':
    case 'normalize':
    case 'withMetadata':
    case 'withoutChromaSubsampling':
    case 'withoutAdaptiveFiltering':
    case 'trellisQuantization':
    case 'trellisQuantisation':
    case 'overshootDeringing':
    case 'optimizeScans':
    case 'optimiseScans':
      return args.length === 0;
    // Not supported: overlayWith

    case 'metadata':
      return args.length === 0 || (args.length === 1 && args[0] === true);

    // Engines:
    case 'sharp':
    case 'gm':
      return args.length === 0;

    // FIXME: Add validation code for all the below.
    // https://github.com/papandreou/express-processimage/issues/4
    // Other engines:
    case 'pngcrush':
    case 'pngquant':
    case 'jpegtran':
    case 'optipng':
    case 'svgfilter':
    case 'inkscape':
      return true;

    // Graphicsmagick specific operations:
    // FIXME: Add validation code for all the below.
    // https://github.com/papandreou/express-processimage/issues/4
    case 'setFormat':
    case 'identify':
    case 'selectFrame':
    case 'subCommand':
    case 'adjoin':
    case 'affine':
    case 'alpha':
    case 'append':
    case 'authenticate':
    case 'average':
    case 'backdrop':
    case 'blackThreshold':
    case 'bluePrimary':
    case 'border':
    case 'borderColor':
    case 'box':
    case 'channel':
    case 'chop':
    case 'clip':
    case 'coalesce':
    case 'colorize':
    case 'colorMap':
    case 'compose':
    case 'compress':
    case 'convolve':
    case 'createDirectories':
    case 'deconstruct':
    case 'define':
    case 'delay':
    case 'displace':
    case 'display':
    case 'dispose':
    case 'dissolve':
    case 'encoding':
    case 'endian':
    case 'file':
    case 'foreground':
    case 'frame':
    case 'fuzz':
    case 'gaussian':
    case 'geometry':
    case 'greenPrimary':
    case 'highlightColor':
    case 'highlightStyle':
    case 'iconGeometry':
    case 'intent':
    case 'lat':
    case 'level':
    case 'list':
    case 'log':
    case 'loop':
    case 'map':
    case 'mask':
    case 'matte':
    case 'matteColor':
    case 'maximumError':
    case 'mode':
    case 'monitor':
    case 'mosaic':
    case 'motionBlur':
    case 'name':
    case 'noop':
    case 'opaque':
    case 'operator':
    case 'orderedDither':
    case 'outputDirectory':
    case 'page':
    case 'pause':
    case 'pen':
    case 'ping':
    case 'pointSize':
    case 'preview':
    case 'process':
    case 'profile':
    case 'progress':
    case 'randomThreshold':
    case 'recolor':
    case 'redPrimary':
    case 'remote':
    case 'render':
    case 'repage':
    case 'sample':
    case 'samplingFactor':
    case 'scene':
    case 'scenes':
    case 'screen':
    case 'set':
    case 'segment':
    case 'shade':
    case 'shadow':
    case 'sharedMemory':
    case 'shave':
    case 'shear':
    case 'silent':
    case 'rawSize':
    case 'snaps':
    case 'stegano':
    case 'stereo':
    case 'textFont':
    case 'texture':
    case 'thumbnail':
    case 'title':
    case 'transform':
    case 'transparent':
    case 'treeDepth':
    case 'update':
    case 'units':
    case 'unsharp':
    case 'usePixmap':
    case 'view':
    case 'virtualPixel':
    case 'visual':
    case 'watermark':
    case 'wave':
    case 'whitePoint':
    case 'whiteThreshold':
    case 'window':
    case 'windowGroup':
    case 'strip':
    case 'interlace':
    case 'resizeExact':
    case 'scale':
    case 'filter':
    case 'density':
    case 'noProfile':
    case 'resample':
    case 'magnify':
    case 'minify':
    case 'charcoal':
    case 'modulate':
    case 'antialias':
    case 'bitdepth':
    case 'colors':
    case 'colorspace':
    case 'comment':
    case 'contrast':
    case 'cycle':
    case 'despeckle':
    case 'dither':
    case 'monochrome':
    case 'edge':
    case 'emboss':
    case 'enhance':
    case 'equalize':
    case 'implode':
    case 'label':
    case 'limit':
    case 'median':
    case 'negative':
    case 'noise':
    case 'paint':
    case 'raise':
    case 'lower':
    case 'region':
    case 'roll':
    case 'solarize':
    case 'spread':
    case 'swirl':
    case 'type':
    case 'trim':
    case 'extent':
    case 'gravity':
    case 'fill':
    case 'stroke':
    case 'strokeWidth':
    case 'font':
    case 'fontSize':
    case 'draw':
    case 'drawPoint':
    case 'drawLine':
    case 'drawRectangle':
    case 'drawArc':
    case 'drawEllipse':
    case 'drawCircle':
    case 'drawPolyline':
    case 'drawPolygon':
    case 'drawBezier':
    case 'drawText':
    case 'setDraw':
    case 'thumb':
    case 'thumbExact':
    case 'morph':
    case 'sepia':
    case 'autoOrient':
    case 'in':
    case 'out':
    case 'preprocessor':
    case 'addSrcFormatter':
    case 'inputIs':
    case 'compare':
    case 'composite':
    case 'montage':
      return true;
    default:
      return false;
  }
}

module.exports = function getFilterInfosAndTargetContentTypeFromQueryString(
  queryString,
  options
) {
  options = options || {};
  var filters = options.filters || {};
  var filterInfos = [];
  var defaultEngineName =
    options.defaultEngineName || (sharp && 'sharp') || 'gm';
  var currentEngineName;
  var operations = [];
  var operationNames = [];
  var usedQueryStringFragments = [];
  var leftOverQueryStringFragments = [];
  var sourceMetadata = options.sourceMetadata || {};
  var targetContentType = sourceMetadata.contentType;
  var root = options.root || options.rootPath;

  function checkSharpOrGmOperation(operation) {
    if (
      operation.name === 'resize' &&
      typeof options.maxOutputPixels === 'number' &&
      operation.args.length >= 2 &&
      operation.args[0] * operation.args[1] > options.maxOutputPixels
    ) {
      // FIXME: Realizing that we're going over the limit when only one resize operand is given would require knowing the metadata.
      // It's a big wtf that the maxOutputPixels option is only enforced some of the time.
      throw new errors.OutputDimensionsExceeded(
        'resize: Target dimensions of ' +
          operation.args[0] +
          'x' +
          operation.args[1] +
          ' exceed maxOutputPixels (' +
          options.maxOutputPixels +
          ')'
      );
    }
  }

  function flushOperations() {
    if (operations.length > 0) {
      var engineName = currentEngineName;
      var operationIndex = operationNames.length;
      operationNames.push('sharpOrGm');
      filterInfos.push({
        operationName: 'sharpOrGm',
        operations: operations,
        usedQueryStringFragments: operations.map(function(operation) {
          return operation.usedQueryStringFragment;
        }),
        create: function() {
          var sourceContentType =
            (this.operations[0] && this.operations[0].sourceContentType) ||
            sourceMetadata.contentType;
          if (
            sourceContentType === 'image/gif' &&
            !this.operations.some(function(operation) {
              return (
                operation.name === 'setFormat' &&
                sharpFormats.indexOf(operation.args[0]) > -1
              );
            })
          ) {
            engineName = 'gm';
            // Gotcha: gifsicle does not support --resize-fit in a way where the image will be enlarged
            // to fit the bounding box, so &withoutEnlargement is assumed, but not required:
            // Raised the issue here: https://github.com/kohler/gifsicle/issues/67
            if (
              filters.gifsicle !== false &&
              Gifsicle &&
              this.operations.every(function(operation) {
                return (
                  operation.name === 'resize' ||
                  operation.name === 'extract' ||
                  operation.name === 'rotate' ||
                  operation.name === 'withoutEnlargement' ||
                  operation.name === 'progressive' ||
                  operation.name === 'crop' ||
                  operation.name === 'ignoreAspectRatio' ||
                  (operation.name === 'setFormat' &&
                    operation.args[0] === 'gif')
                );
              })
            ) {
              engineName = 'gifsicle';
            }
          }

          this.targetContentType =
            this.outputContentType || targetContentType || sourceContentType;

          var operations = this.operations;
          this.operationName = engineName;
          operationNames[operationIndex] = engineName;
          if (engineName === 'gifsicle') {
            var gifsicleArgs = [];
            var seenOperationThatMustComeBeforeExtract = false;
            var gifsicles = [];
            var flush = function() {
              if (gifsicleArgs.length > 0) {
                gifsicles.push(new Gifsicle(gifsicleArgs));
                seenOperationThatMustComeBeforeExtract = false;
                gifsicleArgs = [];
              }
            };

            operations.forEach(function(operation) {
              if (operation.name === 'resize') {
                if (operation.args[0] === undefined) {
                  gifsicleArgs.push('--resize-height', operation.args[1]);
                } else if (operation.args[1] === undefined) {
                  gifsicleArgs.push('--resize-width', operation.args[0]);
                } else {
                  if (
                    operations.some(function(operation) {
                      return operation.name === 'ignoreAspectRatio';
                    })
                  ) {
                    gifsicleArgs.push(
                      '--resize',
                      operation.args[0] + 'x' + operation.args[1]
                    );
                  } else {
                    gifsicleArgs.push(
                      '--resize-fit',
                      operation.args[0] + 'x' + operation.args[1]
                    );
                  }
                }
                seenOperationThatMustComeBeforeExtract = true;
              } else if (operation.name === 'extract') {
                if (seenOperationThatMustComeBeforeExtract) {
                  flush();
                }
                gifsicleArgs.push(
                  '--crop',
                  operation.args[0] +
                    ',' +
                    operation.args[1] +
                    '+' +
                    operation.args[2] +
                    'x' +
                    operation.args[3]
                );
              } else if (
                operation.name === 'rotate' &&
                /^(?:90|180|270)$/.test(operation.args[0])
              ) {
                gifsicleArgs.push('--rotate-' + operation.args[0]);
                seenOperationThatMustComeBeforeExtract = true;
              } else if (operation.name === 'progressive') {
                gifsicleArgs.push('--interlace');
              }
            });
            flush();
            return gifsicles.length === 1 ? gifsicles[0] : gifsicles;
          } else if (engineName === 'sharp') {
            var sharpOperationsForThisInstance = [].concat(operations);
            if (options.maxInputPixels) {
              sharpOperationsForThisInstance.unshift({
                name: 'limitInputPixels',
                args: [options.maxInputPixels]
              });
            }
            var sharpInstance = sharp();
            if (
              operations.some(function(operation) {
                return operation.name === 'resize';
              })
            ) {
              sharpInstance.max();
            }

            // Sharp has deprecated the use of progressive() and quality(<int>) in favor of
            // passing those options to an explicit conversion, eg. .jpeg({quality: ..., progressive: true})
            var converterOptions;
            var converterOperation;
            for (var i = 0; i < sharpOperationsForThisInstance.length; i += 1) {
              var operation = sharpOperationsForThisInstance[i];
              if (
                operation.name === 'progressive' ||
                operation.name === 'quality'
              ) {
                var value = true;
                if (operation.args && operation.args[0]) {
                  value = operation.args[0];
                }
                converterOptions = converterOptions || {};
                converterOptions[operation.name] = value;
                sharpOperationsForThisInstance.splice(i, 1);
                i -= 1;
              } else if (sharpFormats.indexOf(operation.name) !== -1) {
                converterOperation = operation;
              }
            }
            if (converterOptions) {
              if (converterOperation) {
                converterOperation.args = converterOperation.args || [];
                converterOperation.args[0] = converterOperation.args[0] || {};
                _.extend(converterOperation.args[0], converterOptions);
              } else {
                sharpOperationsForThisInstance.push({
                  name: this.targetContentType.replace(/^image\//, ''),
                  args: [converterOptions]
                });
              }
            }

            sharpOperationsForThisInstance.forEach(function(operation) {
              checkSharpOrGmOperation(operation);
              var args = operation.args;
              // Support setFormat operation
              if (operation.name === 'setFormat' && args.length === 1) {
                operation.name = args[0]; // use the argument as the target format
                args = [];
              }
              // Compensate for https://github.com/lovell/sharp/issues/276
              if (operation.name === 'extract' && args.length >= 4) {
                args = [
                  {
                    left: args[0],
                    top: args[1],
                    width: args[2],
                    height: args[3]
                  }
                ];
              }
              sharpInstance[operation.name].apply(sharpInstance, args);
            });
            return sharpInstance;
          } else if (engineName === 'gm') {
            var gmOperationsForThisInstance = [].concat(operations);
            // For some reason the gm module doesn't expose itself as a readable/writable stream,
            // so we need to wrap it into one:

            var readStream = new Stream();
            readStream.readable = true;

            var readWriteStream = new Stream();
            readWriteStream.readable = readWriteStream.writable = true;
            var spawned = false;
            readWriteStream.write = function(chunk) {
              if (!spawned) {
                spawned = true;
                var seenData = false;
                var hasEnded = false;
                var gmInstance = gm(
                  readStream,
                  getMockFileNameForContentType(
                    gmOperationsForThisInstance[0].sourceContentType ||
                      sourceMetadata.contentType
                  )
                );
                if (options.maxInputPixels) {
                  gmInstance.limit('pixels', options.maxInputPixels);
                }
                var resize;
                var crop;
                var withoutEnlargement;
                var ignoreAspectRatio;
                for (
                  var i = 0;
                  i < gmOperationsForThisInstance.length;
                  i += 1
                ) {
                  var gmOperation = gmOperationsForThisInstance[i];
                  if (gmOperation.name === 'resize') {
                    resize = gmOperation;
                  } else if (gmOperation.name === 'crop') {
                    crop = gmOperation;
                  } else if (gmOperation.name === 'withoutEnlargement') {
                    withoutEnlargement = gmOperation;
                  } else if (gmOperation.name === 'ignoreAspectRatio') {
                    ignoreAspectRatio = gmOperation;
                  }
                }
                if (resize) {
                  var flags = '';
                  if (withoutEnlargement) {
                    flags += '>';
                  }
                  if (ignoreAspectRatio) {
                    flags += '!';
                  }
                  if (crop) {
                    gmOperationsForThisInstance.push({
                      name: 'extent',
                      args: [].concat(resize.args)
                    });
                    flags += '^';
                  }
                  if (flags.length > 0) {
                    resize.args.push(flags);
                  }
                }
                gmOperationsForThisInstance
                  .reduce(function(gmInstance, gmOperation) {
                    checkSharpOrGmOperation(gmOperation);
                    if (
                      gmOperation.name === 'rotate' &&
                      gmOperation.args.length === 1
                    ) {
                      gmOperation = _.extend({}, gmOperation);
                      gmOperation.args = ['transparent', gmOperation.args[0]];
                    }
                    if (gmOperation.name === 'extract') {
                      gmOperation.name = 'crop';
                      gmOperation.args = [
                        gmOperation.args[2],
                        gmOperation.args[3],
                        gmOperation.args[0],
                        gmOperation.args[1]
                      ];
                    } else if (gmOperation.name === 'crop') {
                      gmOperation.name = 'gravity';
                      gmOperation.args = [
                        {
                          northwest: 'NorthWest',
                          north: 'North',
                          northeast: 'NorthEast',
                          west: 'West',
                          center: 'Center',
                          east: 'East',
                          southwest: 'SouthWest',
                          south: 'South',
                          southeast: 'SouthEast'
                        }[String(gmOperation.args[0]).toLowerCase()] || 'Center'
                      ];
                    }
                    if (gmOperation.name === 'progressive') {
                      gmOperation.name = 'interlace';
                      gmOperation.args = ['line'];
                    }
                    if (typeof gmInstance[gmOperation.name] === 'function') {
                      if (
                        gmOperation.name === 'resize' &&
                        gmOperation.args[1] === undefined
                      ) {
                        // gm 1.3.18 does not support `-resize 500x` so make sure we omit the x:
                        return gmInstance.out(
                          '-resize',
                          gmOperation.args[0] + (gmOperation[2] || '')
                        );
                      } else {
                        return gmInstance[gmOperation.name].apply(
                          gmInstance,
                          gmOperation.args
                        );
                      }
                    } else {
                      return gmInstance;
                    }
                  }, gmInstance)
                  .stream(function(err, stdout, stderr) {
                    if (err) {
                      hasEnded = true;
                      return readWriteStream.emit('error', err);
                    }
                    stdout
                      .on('data', function(chunk) {
                        seenData = true;
                        readWriteStream.emit('data', chunk);
                      })
                      .once('end', function() {
                        if (!hasEnded) {
                          if (seenData) {
                            readWriteStream.emit('end');
                          } else {
                            readWriteStream.emit(
                              'error',
                              new Error(
                                'The gm stream ended without emitting any data'
                              )
                            );
                          }
                          hasEnded = true;
                        }
                      });
                  });
              }
              readStream.emit('data', chunk);
            };
            readWriteStream.end = function(chunk) {
              if (chunk) {
                readWriteStream.write(chunk);
              }
              readStream.emit('end');
            };
            return readWriteStream;
          } else {
            throw new Error('Internal error');
          }
        }
      });
      operations = [];
    }
    currentEngineName = undefined;
  }

  var keyValuePairs = queryString.split('&');
  keyValuePairs.forEach(function(keyValuePair) {
    var matchKeyValuePair = keyValuePair.match(/^([^=]+)(?:=(.*))?/);
    if (matchKeyValuePair) {
      var operationName = decodeURIComponent(matchKeyValuePair[1]);
      // Split by non-URL encoded comma or plus:
      var operationArgs = matchKeyValuePair[2]
        ? matchKeyValuePair[2].split(/[+,]/).map(function(arg) {
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
          })
        : [];

      if (
        !isValidOperation(operationName, operationArgs) ||
        (typeof options.allowOperation === 'function' &&
          !options.allowOperation(operationName, operationArgs))
      ) {
        leftOverQueryStringFragments.push(keyValuePair);
      } else {
        if (operationName === 'resize') {
          if (typeof options.maxOutputPixels === 'number') {
            if (operationArgs[0] === '') {
              operationArgs[0] = Math.floor(
                options.maxOutputPixels / operationArgs[1]
              );
            } else if (operationArgs[1] === '') {
              operationArgs[1] = Math.floor(
                options.maxOutputPixels / operationArgs[0]
              );
            }
          } else {
            operationArgs = operationArgs.map(function(arg) {
              return arg === '' ? undefined : arg;
            });
          }
        }

        var filterInfo;
        if (filters[operationName]) {
          flushOperations();
          filterInfo = filters[operationName](operationArgs, {
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
        } else if (operationName === 'metadata' && sharp) {
          flushOperations();
          filterInfos.push({
            metadata: true,
            sourceContentType: targetContentType || sourceMetadata.contentType,
            outputContentType: targetContentType,
            create: function() {
              var sourceContentType = this.sourceContentType;
              var sharpInstance = sharp();
              var duplexStream = new Stream.Duplex();
              var animatedGifDetector;
              var isAnimated;
              if (sourceContentType === 'image/gif') {
                animatedGifDetector = createAnimatedGifDetector();
                animatedGifDetector.once('animated', function() {
                  isAnimated = true;
                  this.emit('decided');
                  animatedGifDetector = null;
                });

                duplexStream.once('finish', function() {
                  if (typeof isAnimated === 'undefined') {
                    isAnimated = false;
                    if (animatedGifDetector) {
                      animatedGifDetector.emit('decided', false);
                      animatedGifDetector = null;
                    }
                  }
                });
              }
              duplexStream._write = function(chunk, encoding, cb) {
                if (animatedGifDetector) {
                  animatedGifDetector.write(chunk);
                }
                if (
                  sharpInstance &&
                  sharpInstance.write(chunk, encoding) === false &&
                  !animatedGifDetector
                ) {
                  sharpInstance.once('drain', cb);
                } else {
                  cb();
                }
              };
              // Make sure that we do not call sharpInstance.metadata multiple times:
              var metadataCalled = false;
              duplexStream._read = function(size) {
                if (metadataCalled) {
                  return;
                }
                metadataCalled = true;
                // Caveat: sharp's metadata will buffer the entire compressed image before
                // calling the callback :/
                // https://github.com/lovell/sharp/issues/236
                sharpInstance.metadata(function(err, metadata) {
                  sharpInstance = null;
                  if (err) {
                    metadata = _.defaults(
                      { error: err.message },
                      sourceMetadata
                    );
                  } else {
                    if (metadata.format === 'magick') {
                      // https://github.com/lovell/sharp/issues/377
                      metadata.contentType = sourceContentType;
                      metadata.format =
                        sourceContentType &&
                        sourceContentType.replace(/^image\//, '');
                    } else if (metadata.format) {
                      // metadata.format is one of 'jpeg', 'png', 'webp' so this should be safe:
                      metadata.contentType = 'image/' + metadata.format;
                    }
                    _.defaults(metadata, sourceMetadata);
                    if (metadata.exif) {
                      var exifData;
                      try {
                        exifData = exifReader(metadata.exif);
                      } catch (e) {
                        // Error: Invalid EXIF
                      }
                      metadata.exif = undefined;
                      if (exifData) {
                        const orientation =
                          exifData.image && exifData.image.Orientation;
                        // Check if the image.Orientation EXIF tag specifies says that the
                        // width and height are to be flipped
                        // http://sylvana.net/jpegcrop/exif_orientation.html
                        if (
                          typeof orientation === 'number' &&
                          orientation >= 5 &&
                          orientation <= 8
                        ) {
                          metadata.orientedWidth = metadata.height;
                          metadata.orientedHeight = metadata.width;
                        } else {
                          metadata.orientedWidth = metadata.width;
                          metadata.orientedHeight = metadata.height;
                        }
                        _.defaults(metadata, exifData);
                      }
                    }
                    if (metadata.icc) {
                      try {
                        metadata.icc = icc.parse(metadata.icc);
                      } catch (e) {
                        // Error: Error: Invalid ICC profile, remove the Buffer
                        metadata.icc = undefined;
                      }
                    }
                    if (metadata.format === 'magick') {
                      metadata.contentType = targetContentType;
                    }
                  }
                  function proceed() {
                    duplexStream.push(JSON.stringify(metadata));
                    duplexStream.push(null);
                  }
                  if (typeof isAnimated === 'boolean') {
                    metadata.animated = isAnimated;
                    proceed();
                  } else if (animatedGifDetector) {
                    animatedGifDetector.once('decided', function(isAnimated) {
                      metadata.animated = isAnimated;
                      proceed();
                    });
                  } else {
                    proceed();
                  }
                });
              };
              duplexStream.once('finish', function() {
                if (sharpInstance) {
                  sharpInstance.end();
                }
              });
              return duplexStream;
            }
          });
          targetContentType = 'application/json; charset=utf-8';
          usedQueryStringFragments.push(keyValuePair);
        } else if (isOperationByEngineNameAndName[operationName]) {
          usedQueryStringFragments.push(keyValuePair);
          flushOperations();
          defaultEngineName = operationName;
        } else if (engineNamesByOperationName[operationName]) {
          // Check if at least one of the engines supporting this operation is allowed
          var candidateEngineNames = engineNamesByOperationName[
            operationName
          ].filter(function(engineName) {
            return filters[engineName] !== false;
          });
          if (candidateEngineNames.length > 0) {
            if (
              currentEngineName &&
              !isOperationByEngineNameAndName[currentEngineName]
            ) {
              flushOperations();
            }

            if (
              !currentEngineName ||
              candidateEngineNames.indexOf(currentEngineName) === -1
            ) {
              flushOperations();
              if (candidateEngineNames.indexOf(defaultEngineName) !== -1) {
                currentEngineName = defaultEngineName;
              } else {
                currentEngineName = candidateEngineNames[0];
              }
            }
            var sourceContentType = targetContentType;
            var targetFormat;
            if (operationName === 'setFormat' && operationArgs.length > 0) {
              targetFormat = operationArgs[0].toLowerCase();
              if (targetFormat === 'jpg') {
                targetFormat = 'jpeg';
              }
            } else if (
              operationName === 'jpeg' ||
              operationName === 'png' ||
              operationName === 'webp'
            ) {
              targetFormat = operationName;
              operationName = 'setFormat';
            }
            if (targetFormat) {
              operationArgs = [targetFormat];
              targetContentType = 'image/' + targetFormat;
              // fallback to another engine if the requested format is not supported by sharp
              if (
                currentEngineName === 'sharp' &&
                sharpFormats.indexOf(targetFormat) === -1
              ) {
                currentEngineName = 'gm';
              }
            }
            operations.push({
              sourceContentType: sourceContentType,
              name: operationName,
              args: operationArgs,
              usedQueryStringFragment: keyValuePair
            });
            usedQueryStringFragments.push(keyValuePair);
          }
        } else {
          var operationNameLowerCase = operationName.toLowerCase();

          var FilterConstructor =
            filterConstructorByOperationName[operationNameLowerCase];
          if (FilterConstructor && filters[operationNameLowerCase] !== false) {
            operationNames.push(operationNameLowerCase);
            flushOperations();
            if (
              operationNameLowerCase === 'svgfilter' &&
              root &&
              options.sourceFilePath
            ) {
              operationArgs.push(
                '--root',
                'file://' + root,
                '--url',
                'file://' + options.sourceFilePath
              );
            }
            filterInfo = {
              create: function() {
                return new FilterConstructor(operationArgs);
              },
              operationName: operationNameLowerCase,
              usedQueryStringFragments: [keyValuePair]
            };
            filterInfos.push(filterInfo);
            usedQueryStringFragments.push(keyValuePair);
            if (operationNameLowerCase === 'inkscape') {
              var filter = filterInfo.create();
              filterInfo.create = function() {
                return filter;
              };
              targetContentType = 'image/' + filter.outputFormat;
            }
          } else {
            leftOverQueryStringFragments.push(keyValuePair);
          }
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

module.exports.sharp = sharp;
