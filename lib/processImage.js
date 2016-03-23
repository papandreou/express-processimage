var Path = require('path'),
    _ = require('underscore'),
    httpErrors = require('httperrors'),
    getFilterInfosAndTargetContentTypeFromQueryString = require('./getFilterInfosAndTargetContentTypeFromQueryString'),
    mime = require('mime');

var hijackResponse = require('hijackresponse-nobackpressure');

var isImageByExtension = {};

Object.keys(mime.extensions).forEach(function (contentType) {
    if (/^image\//.test(contentType)) {
        var extension = mime.extensions[contentType];
        isImageByExtension[extension] = true;
    }
});

isImageByExtension.jpg = true;

function isImageExtension(extension) {
    return isImageByExtension[extension.toLowerCase()];
}

module.exports = function (options) {
    options = options || {};

    if (typeof options.sharpCache !== 'undefined' && getFilterInfosAndTargetContentTypeFromQueryString.sharp) {
        getFilterInfosAndTargetContentTypeFromQueryString.sharp.cache(options.sharpCache);
    }
    return function (req, res, next) {
        var matchExtensionAndQueryString = req.url.match(/\.(\w+)\?(.*)$/);
        var isMetadataRequest = matchExtensionAndQueryString && /^(?:.*&)?metadata(?:$|&|=true)/.test(matchExtensionAndQueryString[2]);
        if (matchExtensionAndQueryString && ((isImageExtension(matchExtensionAndQueryString[1]) && req.accepts('image/*')) || isMetadataRequest)) {
            // Prevent If-None-Match revalidation with the downstream middleware with ETags that aren't suffixed with "-processimage":
            var queryString = matchExtensionAndQueryString[2],
                ifNoneMatch = req.headers['if-none-match'];
            if (ifNoneMatch) {
                var validIfNoneMatchTokens = ifNoneMatch.split(' ').filter(function (etag) {
                    return (/-processimage["-]/).test(etag);
                });
                if (validIfNoneMatchTokens.length > 0) {
                    req.headers['if-none-match'] = validIfNoneMatchTokens.join(' ');
                } else {
                    delete req.headers['if-none-match'];
                }
            }
            delete req.headers['if-modified-since']; // Prevent false positive conditional GETs after enabling processimage
            hijackResponse(res, function (err, res) {
                var contentType = res.getHeader('Content-Type'),
                    etagFragments = [],
                    hasEnded = false,
                    filters = [];

                function sendErrorResponse(err) {
                    if (!hasEnded) {
                        hasEnded = true;
                        if ('commandLine' in this) {
                            err.message = this.commandLine + ': ' + err.message;
                        }
                        if (err.message === 'Input buffer contains unsupported image format') {
                            err = new httpErrors.UnsupportedMediaType(err.message);
                        }
                        if (err.message === 'Input image exceeds pixel limit') {
                            // ?metadata with an unrecognized image format
                            err = new httpErrors.RequestEntityTooLarge(err.message);
                        }

                        res.unhijack();
                        next(err);
                        // the filters are unpiped after the error is passed to
                        // next. doing the unpiping before calling next caused
                        // the tests to fail on node 0.12 (not on 4.0 and 0.10).
                        if (filters) {
                            filters.forEach(function (filter) {
                                if (filter.unpipe) {
                                    filter.unpipe();
                                }
                                if (filter.kill) {
                                    filter.kill();
                                } else if (filter.destroy) {
                                    filter.destroy();
                                }
                            });
                        }
                    }
                }

                if (contentType && (contentType.indexOf('image/') === 0 || isMetadataRequest)) {
                    var contentLengthHeaderValue = res.getHeader('Content-Length');
                    var filterInfosAndTargetFormat = getFilterInfosAndTargetContentTypeFromQueryString(queryString, _.defaults({
                            allowOperation: options.allowOperation,
                            sourceFilePath: options.root && Path.resolve(options.root, req.url.substr(1)),
                            sourceMetadata: {
                                contentType: contentType,
                                filesize: contentLengthHeaderValue && parseInt(contentLengthHeaderValue, 10),
                                etag: res.getHeader('ETag')
                            }
                        }, options)),
                        targetContentType = filterInfosAndTargetFormat.targetContentType;
                    if (filterInfosAndTargetFormat.filterInfos.length === 0) {
                        return res.unhijack(true);
                    }
                    if (targetContentType) {
                        res.setHeader('Content-Type', targetContentType);
                    }
                    res.removeHeader('Content-Length');
                    var oldETag = res.getHeader('ETag'),
                        newETag;
                    if (oldETag) {
                        newETag = oldETag.replace(/"$/g, '-processimage"');
                        res.setHeader('ETag', newETag);

                        if (ifNoneMatch && ifNoneMatch.indexOf(newETag) !== -1) {
                            return res.status(304).end();
                        }
                    }
                    try {
                        filterInfosAndTargetFormat.filterInfos.forEach(function (filterInfo) {
                            filters.push(filterInfo.create());
                        });
                    } catch (e) {
                        return sendErrorResponse(new httpErrors.BadRequest(e));
                    }
                    if (options.debug) {
                        // Only used by the test suite to assert that the right engine is used to process gifs:
                        res.setHeader('X-Express-Processimage', filterInfosAndTargetFormat.filterInfos.map(function (filterInfo) {
                            return filterInfo.operationName;
                        }).join(','));
                    }
                    for (var i = 0 ; i < filters.length ; i += 1) {
                        if (i < filters.length - 1) {
                            filters[i].pipe(filters[i + 1]);
                        }
                        filters[i].on('etagFragment', function (etagFragment) {
                            etagFragments.push(etagFragment);
                        });
                        filters[i].on('error', sendErrorResponse);
                    }

                    res.pipe(filters[0]);
                    filters[filters.length - 1].on('end', function () {
                        hasEnded = true;
                    }).pipe(res);

                    res.on('error', function () {
                        res.unhijack();
                        next(500);
                    });
                } else {
                    res.unhijack();
                }
            });
            next();
        } else {
            next();
        }
    };
};
