var Path = require('path');

var _ = require('underscore');

var httpErrors = require('httperrors');

var getFilterInfosAndTargetContentTypeFromQueryString = require('./getFilterInfosAndTargetContentTypeFromQueryString');

var mime = require('mime');

var stream = require('stream');

var accepts = require('accepts');

var hijackResponse = require('hijackresponse');

var isImageByExtension = {};

Object.keys(mime._extensions).forEach(function(contentType) {
  if (/^image\//.test(contentType)) {
    var extension = mime._extensions[contentType];
    isImageByExtension[extension] = true;
  }
});

isImageByExtension.jpg = true;

function isImageExtension(extension) {
  return isImageByExtension[extension.toLowerCase()];
}

module.exports = function(options) {
  options = options || {};

  if (
    typeof options.sharpCache !== 'undefined' &&
    getFilterInfosAndTargetContentTypeFromQueryString.sharp
  ) {
    getFilterInfosAndTargetContentTypeFromQueryString.sharp.cache(
      options.sharpCache
    );
  }
  return function(req, res, next) {
    // Polyfill req.accepts for browser-sync compatibility
    if (typeof req.accepts !== 'function') {
      req.accepts = function requestAccepts() {
        var accept = accepts(req);
        return accept.types.apply(accept, arguments);
      };
    }

    var matchExtensionAndQueryString = req.url.match(/\.(\w+)\?(.*)$/);
    var isMetadataRequest =
      matchExtensionAndQueryString &&
      /^(?:.*&)?metadata(?:$|&|=true)/.test(matchExtensionAndQueryString[2]);
    if (
      matchExtensionAndQueryString &&
      (req.method === 'GET' || req.method === 'HEAD') &&
      ((isImageExtension(matchExtensionAndQueryString[1]) &&
        req.accepts('image/*')) ||
        isMetadataRequest)
    ) {
      // Prevent If-None-Match revalidation with the downstream middleware with ETags that aren't suffixed with "-processimage":
      var queryString = matchExtensionAndQueryString[2];

      var ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch) {
        var validIfNoneMatchTokens = ifNoneMatch
          .split(' ')
          .filter(function(etag) {
            return /-processimage["-]/.test(etag);
          });
        if (validIfNoneMatchTokens.length > 0) {
          req.headers['if-none-match'] = validIfNoneMatchTokens
            .map(function(token) {
              return token.replace(/-processimage(["-])/, '$1');
            })
            .join(' ');
        } else {
          delete req.headers['if-none-match'];
        }
      }
      delete req.headers['if-modified-since']; // Prevent false positive conditional GETs after enabling processimage
      // hijackResponse will never pass an error here
      // eslint-disable-next-line handle-callback-err
      hijackResponse(
        res,
        function(err, res) {
          // Polyfill res.status for browser-sync compatibility
          if (typeof res.status !== 'function') {
            res.status = function status(statusCode) {
              res.statusCode = statusCode;
              return res;
            };
          }

          var sourceMetadata;
          function makeFilterInfosAndTargetFormat() {
            return getFilterInfosAndTargetContentTypeFromQueryString(
              queryString,
              _.defaults(
                {
                  allowOperation: options.allowOperation,
                  sourceFilePath:
                    options.root &&
                    Path.resolve(options.root, req.url.substr(1)),
                  sourceMetadata: sourceMetadata
                },
                options
              )
            );
          }

          var contentLengthHeaderValue = res.getHeader('Content-Length');
          res.removeHeader('Content-Length');
          var oldETag = res.getHeader('ETag');

          var newETag;
          if (oldETag) {
            newETag = oldETag.replace(/"$/g, '-processimage"');
            res.setHeader('ETag', newETag);
            if (ifNoneMatch && ifNoneMatch.indexOf(newETag) !== -1) {
              res.destroyHijacked();
              return res.status(304).end();
            }
          }

          function startProcessing(optionalFirstChunk) {
            var hasEnded = false;

            var cleanedUp = false;

            var filters;
            function cleanUp(doNotDestroyHijacked) {
              if (!doNotDestroyHijacked) {
                res.destroyHijacked();
              }
              if (!cleanedUp) {
                cleanedUp = true;
                // the filters are unpiped after the error is passed to
                // next. doing the unpiping before calling next caused
                // the tests to fail on node 0.12 (not on 4.0 and 0.10).
                if (
                  res._readableState &&
                  res._readableState.buffer &&
                  res._readableState.buffer.length > 0
                ) {
                  res._readableState.buffer = [];
                }
                if (filters) {
                  filters.forEach(function(filter) {
                    if (filter.unpipe) {
                      filter.unpipe();
                    }
                    if (filter.kill) {
                      filter.kill();
                    } else if (filter.destroy) {
                      filter.destroy();
                    } else if (filter.resume) {
                      filter.resume();
                    }
                    if (filter.end) {
                      filter.end();
                    }
                    if (
                      filter._readableState &&
                      filter._readableState.buffer &&
                      filter._readableState.buffer.length > 0
                    ) {
                      filter._readableState.buffer = [];
                    }
                    filter.removeAllListeners();
                    // Some of the filters seem to emit error more than once sometimes:
                    filter.on('error', function() {});
                  });
                  filters = null;
                }
                res.removeAllListeners();
              }
            }

            function handleError(err) {
              if (!hasEnded) {
                hasEnded = true;
                if (err) {
                  if ('commandLine' in this) {
                    err.message = this.commandLine + ': ' + err.message;
                  }
                  if (
                    err.message ===
                    'Input buffer contains unsupported image format'
                  ) {
                    err = new httpErrors.UnsupportedMediaType(err.message);
                  }
                  if (err.message === 'Input image exceeds pixel limit') {
                    // ?metadata with an unrecognized image format
                    err = new httpErrors.RequestEntityTooLarge(err.message);
                  }

                  next(err);
                }
                res.unhijack();
                cleanUp(true);
              }
            }

            res.once('error', function() {
              res.unhijack();
              next(500);
            });
            res.once('close', cleanUp);
            var targetContentType =
              filterInfosAndTargetFormat.targetContentType;
            if (targetContentType) {
              res.setHeader('Content-Type', targetContentType);
            }
            filters = [];
            try {
              filterInfosAndTargetFormat.filterInfos.forEach(function(
                filterInfo
              ) {
                var filter = filterInfo.create();
                if (Array.isArray(filter)) {
                  Array.prototype.push.apply(filters, filter);
                } else {
                  filters.push(filter);
                }
              });
            } catch (e) {
              return handleError(new httpErrors.BadRequest(e));
            }
            if (filters.length === 0) {
              filters = [new stream.PassThrough()];
            }
            if (options.debug) {
              // Only used by the test suite to assert that the right engine is used to process gifs:
              res.setHeader(
                'X-Express-Processimage',
                filterInfosAndTargetFormat.filterInfos
                  .map(function(filterInfo) {
                    return filterInfo.operationName;
                  })
                  .join(',')
              );
            }
            if (optionalFirstChunk) {
              filters[0].write(optionalFirstChunk);
            }
            for (var i = 0; i < filters.length; i += 1) {
              if (i < filters.length - 1) {
                filters[i].pipe(filters[i + 1]);
              }
              // Some of the filters appear to emit error more than once:
              filters[i].once('error', handleError);
            }

            res.pipe(filters[0]);
            filters[filters.length - 1]
              .on('end', function() {
                hasEnded = true;
                cleanUp();
              })
              .pipe(res);
          }

          var contentType = res.getHeader('Content-Type');
          var filterInfosAndTargetFormat;
          if (res.statusCode === 304) {
            res.unhijack();
          } else if (
            isMetadataRequest ||
            (contentType &&
              (options.allowedImageSourceContentTypes
                ? options.allowedImageSourceContentTypes.indexOf(
                    contentType
                  ) !== -1
                : contentType.indexOf('image/') === 0))
          ) {
            sourceMetadata = {
              contentType: contentType,
              filesize:
                contentLengthHeaderValue &&
                parseInt(contentLengthHeaderValue, 10),
              etag: oldETag
            };

            filterInfosAndTargetFormat = makeFilterInfosAndTargetFormat();

            if (filterInfosAndTargetFormat.filterInfos.length === 0) {
              return res.unhijack(true);
            }
            if (options.secondGuessSourceContentType) {
              var endOrCloseOrErrorBeforeFirstDataChunkListener = function(
                err
              ) {
                if (err) {
                  next(500);
                } else {
                  res.end();
                }
              };
              res.once('error', endOrCloseOrErrorBeforeFirstDataChunkListener);
              res.once('end', endOrCloseOrErrorBeforeFirstDataChunkListener);
              res.once('data', function(firstChunk) {
                res.removeListener(
                  'end',
                  endOrCloseOrErrorBeforeFirstDataChunkListener
                );
                res.removeListener(
                  'close',
                  endOrCloseOrErrorBeforeFirstDataChunkListener
                );
                var detectedContentType;
                if (
                  firstChunk[0] === 0x47 &&
                  firstChunk[1] === 0x49 &&
                  firstChunk[2] === 0x46
                ) {
                  detectedContentType = 'image/gif';
                } else if (firstChunk[0] === 0xff && firstChunk[1] === 0xd8) {
                  detectedContentType = 'image/jpeg';
                } else if (
                  firstChunk[0] === 0x89 &&
                  firstChunk[1] === 0x50 &&
                  firstChunk[2] === 0x4e &&
                  firstChunk[3] === 0x47
                ) {
                  detectedContentType = 'image/png';
                } else if (firstChunk[0] === 0x42 && firstChunk[1] === 0x4d) {
                  detectedContentType = 'image/bmp';
                }
                if (
                  detectedContentType &&
                  detectedContentType !== sourceMetadata.contentType
                ) {
                  sourceMetadata.contentType = detectedContentType;
                  filterInfosAndTargetFormat = makeFilterInfosAndTargetFormat();
                }
                startProcessing(firstChunk);
              });
            } else {
              startProcessing();
            }
          } else {
            res.unhijack();
          }
        },
        { disableBackpressure: true }
      );
      next();
    } else {
      next();
    }
  };
};
