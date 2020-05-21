const Path = require('path');
const httpErrors = require('httperrors');
const impro = require('impro');
const mime = require('mime');
const accepts = require('accepts');
const hijackResponse = require('hijackresponse');

const isImageByExtension = {};
Object.keys(mime._extensions).forEach((contentType) => {
  if (/^image\//.test(contentType)) {
    const extension = mime._extensions[contentType];
    isImageByExtension[extension] = true;
  }
});

isImageByExtension.jpg = true;

function isImageExtension(extension) {
  return isImageByExtension[extension.toLowerCase()];
}

function pickProperties(obj, properties) {
  if (!obj) return {};
  const ret = {};
  for (const property of properties) {
    ret[property] = obj[property];
  }
  return ret;
}

function reverseIteratorFor(arr) {
  let index = arr.length;

  return {
    next: function () {
      index -= 1;

      const isEnded = index < 0;

      return {
        done: isEnded,
        value: !isEnded ? arr[index] : undefined,
      };
    },
    [Symbol.iterator]() {
      return this;
    },
  };
}

function toUsedNames(usedEngines) {
  if (usedEngines.length === 0) {
    return [];
  } else if (usedEngines.length === 1) {
    return [usedEngines[0].name];
  }

  let lastUsedName = usedEngines[0].name;
  const orderedUsedNames = [lastUsedName];
  // keep the first occurrence of every engine listed as used
  usedEngines.forEach(({ name }) => {
    if (name !== lastUsedName) {
      orderedUsedNames.push(name);
      lastUsedName = name;
    }
  });

  return orderedUsedNames;
}

module.exports = (options) => {
  options = options || {};

  const engines = pickProperties(
    options.filters,
    Object.keys(impro.engineByName)
  );

  const middleware = (req, res, next) => {
    // Polyfill req.accepts for browser-sync compatibility
    if (typeof req.accepts !== 'function') {
      req.accepts = function requestAccepts() {
        const accept = accepts(req);
        return accept.types.apply(accept, arguments);
      };
    }

    const matchExtensionAndQueryString = req.url.match(/\.(\w+)\?(.*)$/);
    const isMetadataRequest =
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
      const queryString = matchExtensionAndQueryString[2];

      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch) {
        const validIfNoneMatchTokens = ifNoneMatch
          .split(' ')
          .filter((etag) => /-processimage["-]/.test(etag));
        if (validIfNoneMatchTokens.length > 0) {
          req.headers['if-none-match'] = validIfNoneMatchTokens
            .map((token) => token.replace(/-processimage(["-])/, '$1'))
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
        // hijackresponse never passes the error
        // eslint-disable-next-line handle-callback-err
        (err, res) => {
          // Polyfill res.status for browser-sync compatibility
          if (typeof res.status !== 'function') {
            res.status = function status(statusCode) {
              res.statusCode = statusCode;
              return res;
            };
          }

          let sourceMetadata;

          function makeFilterInfosAndTargetFormat() {
            const parseResult = impro.queryString.parseLegacyQueryString(
              queryString,
              impro,
              options.allowOperation
            );

            // determine the final content type based on the last
            // requested type conversion operation (if present)
            let outputContentType;
            for (const operation of reverseIteratorFor(
              parseResult.operations
            )) {
              if (operation.name === 'metadata') {
                outputContentType = 'application/json; charset=utf-8';
                break;
              } else if (impro.isTypeByName[operation.name]) {
                outputContentType = `image/${operation.name}`;
                break;
              }
            }
            parseResult.outputContentType =
              outputContentType || sourceMetadata.contentType;

            return parseResult;
          }

          const contentLengthHeaderValue = res.getHeader('Content-Length');
          res.removeHeader('Content-Length');
          const oldETag = res.getHeader('ETag');

          let newETag;
          if (oldETag) {
            newETag = oldETag.replace(/"$/g, '-processimage"');
            res.setHeader('ETag', newETag);
            if (ifNoneMatch && ifNoneMatch.indexOf(newETag) !== -1) {
              res.destroyHijacked();
              return res.status(304).end();
            }
          }

          function startProcessing(optionalFirstChunk) {
            let hasEnded = false;
            let cleanedUp = false;

            function cleanUp(doNotDestroyHijacked) {
              if (!cleanedUp) {
                cleanedUp = true;

                if (!doNotDestroyHijacked) {
                  res.destroyHijacked();
                }

                res.removeAllListeners();
              }
            }

            function handleError(err) {
              if (!hasEnded) {
                hasEnded = true;
                if (err) {
                  if ('commandLine' in err) {
                    err.message = `${err.commandLine}: ${err.message}`;
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

                  res.unpipe(pipeline);
                  next(err);
                }
                res.unhijack();
                cleanUp(true);
              }
            }

            res.once('error', (err) => {
              // trigger teardown of all pipeline streams
              pipeline.emit(err);
              // respond with an error
              handleError(err);
            });
            res.once('close', () => {
              cleanUp();
            });

            const outputContentType =
              filterInfosAndTargetFormat.outputContentType;
            if (outputContentType) {
              res.setHeader('Content-Type', outputContentType);
            }

            const type = sourceMetadata && sourceMetadata.contentType;

            const pipeline = impro.createPipeline(
              {
                type,
                sourceMetadata,
                ...engines,
                maxInputPixels: options.maxInputPixels,
                maxOutputPixels: options.maxOutputPixels,
                sharpCache: options.sharpCache,
                svgAssetPath: options.root
                  ? Path.resolve(options.root, req.url.substr(1))
                  : null,
              },
              filterInfosAndTargetFormat.operations
            );

            if (options.debug) {
              let usedEngines;
              try {
                usedEngines = pipeline.flush().usedEngines;
              } catch (e) {
                res.unhijack();
                return next(e);
              }

              // Only used by the test suite to assert that the right engine is used to process gifs:
              res.setHeader(
                'X-Express-Processimage',
                toUsedNames(usedEngines).join(',')
              );
            }

            if (typeof options.onPipeline === 'function') {
              options.onPipeline(pipeline);
            }

            if (optionalFirstChunk) {
              pipeline.write(optionalFirstChunk);
            }

            // send along processed data
            pipeline
              .on('error', handleError)
              .on('end', () => {
                if (!hasEnded) {
                  hasEnded = true;
                  cleanUp();
                  res.end();
                }
              })
              .on('readable', function () {
                if (!hasEnded) {
                  let data;
                  while ((data = this.read())) {
                    res.write(data);
                  }
                }
              });

            // initiate processing
            res.pipe(pipeline);
          }

          const contentType = res.getHeader('Content-Type');
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
              contentType,
              filesize:
                contentLengthHeaderValue &&
                parseInt(contentLengthHeaderValue, 10),
              etag: oldETag,
            };

            filterInfosAndTargetFormat = makeFilterInfosAndTargetFormat();

            if (filterInfosAndTargetFormat.operations.length === 0) {
              return res.unhijack(true);
            }

            if (options.secondGuessSourceContentType) {
              const endOrCloseOrErrorBeforeFirstDataChunkListener = (err) => {
                if (err) {
                  next(500);
                } else {
                  res.end();
                }
              };
              res.once('error', endOrCloseOrErrorBeforeFirstDataChunkListener);
              res.once('end', endOrCloseOrErrorBeforeFirstDataChunkListener);
              res.once('data', (firstChunk) => {
                res.removeListener(
                  'end',
                  endOrCloseOrErrorBeforeFirstDataChunkListener
                );
                res.removeListener(
                  'close',
                  endOrCloseOrErrorBeforeFirstDataChunkListener
                );
                let detectedContentType;
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

  // exposed for some testing scenarios
  middleware._impro = impro;

  return middleware;
};
