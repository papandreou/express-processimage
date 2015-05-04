var Path = require('path'),
    getFilterInfosAndTargetContentTypeFromQueryString = require('./getFilterInfosAndTargetContentTypeFromQueryString'),
    mime = require('mime');

require('express-hijackresponse');

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
    return function (req, res, next) {
        var matchExtensionAndQueryString = req.url.match(/\.(\w+)\?(.*)$/);
        if (matchExtensionAndQueryString && isImageExtension(matchExtensionAndQueryString[1]) && req.accepts('image/*')) {
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
            res.hijack(function (err, res) {
                var contentType = res.getHeader('Content-Type'),
                    etagFragments = [],
                    seenData = false,
                    hasEnded = false;

                function sendErrorResponse(err) {
                    if (!hasEnded) {
                        hasEnded = true;
                        if ('commandLine' in this) {
                            err.message = this.commandLine + ': ' + err.message;
                        }
                        if (seenData) {
                            res.status(500).end();
                        } else {
                            res.unhijack(function () {
                                next(err);
                            });
                        }
                    }
                }

                if (contentType && contentType.indexOf('image/') === 0) {
                    var filterInfosAndTargetFormat = getFilterInfosAndTargetContentTypeFromQueryString(queryString, {
                            rootPath: options.root,
                            sourceFilePath: options.root && Path.resolve(options.root, req.url.substr(1))
                        }),
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
                        newETag = '"' + oldETag.replace(/^"|"$/g, '') + '-processimage"';
                        res.setHeader('ETag', newETag);

                        if (ifNoneMatch && ifNoneMatch.indexOf(newETag) !== -1) {
                            return res.status(304).end();
                        }
                    }

                    var filters = filterInfosAndTargetFormat.filterInfos.map(function (filterInfo) {
                        return filterInfo.create();
                    });

                    for (var i = 0 ; i < filters.length ; i += 1) {
                        if (i < filters.length - 1) {
                            filters[i].pipe(filters[i + 1]);
                        }
                        filters[i].on('etagFragment', function (etagFragment) {
                            etagFragments.push(etagFragment);
                        });
                        filters[i].on('error', sendErrorResponse);
                    }
                    if (filters[0]._readableState) {
                        // For some reason res.pipe(filters[0]) doesn't work with sharp streams. Probably an express-hijackresponse problem.
                        // Work around it by forcing it into streams1 mode, sacrificing backpressure:
                        res.on('data', function (chunk) {
                            filters[0].write(chunk);
                        }).on('end', function () {
                            filters[0].end();
                        });
                    } else {
                        res.pipe(filters[0]);
                    }
                    // Cannot use Stream.prototype.pipe here because it tears down the pipe when the destination stream emits the 'end' event.
                    // There are plans to fix this as part of the streams2 effort: https://github.com/joyent/node/pull/2524
                    // filters[filters.length - 1].pipe(res);
                    filters[filters.length - 1].on('data', function (chunk) {
                        seenData = true;
                        if (!hasEnded) {
                            res.write(chunk);
                        }
                    }).on('end', function () {
                        if (!hasEnded) {
                            if (seenData) {
                                res.end();
                            } else {
                                sendErrorResponse(new Error('Last filter emitted end without producing any output'));
                            }
                        }
                    });

                    res.on('error', function () {
                        res.unhijack();
                        next(500);
                    });
                } else {
                    res.unhijack(true);
                }
            });
            next();
        } else {
            next();
        }
    };
};
