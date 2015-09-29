/*global describe, it, beforeEach, __dirname*/
var express = require('express'),
    fs = require('fs'),
    pathModule = require('path'),
    unexpected = require('unexpected'),
    processImage = require('../lib/processImage'),
    root = pathModule.resolve(__dirname, '..', 'testdata') + '/',
    sharp;

describe.skipIf = function (condition) {
    (condition ? describe.skip : describe).apply(describe, Array.prototype.slice.call(arguments, 1));
};

it.skipIf = function (condition) {
    (condition ? it.skip : it).apply(it, Array.prototype.slice.call(arguments, 1));
};

try {
    sharp = require('sharp');
} catch (e) {}

describe('express-processimage', function () {
    var config;
    beforeEach(function () {
        config = { root: root };
    });

    var expect = unexpected.clone()
        .installPlugin(require('unexpected-express'))
        .installPlugin(require('unexpected-image'))
        .installPlugin(require('unexpected-resemble'))
        .installPlugin(require('magicpen-prism'))
        .addAssertion('to yield response', function (expect, subject, value) {
            return expect(
                express()
                    .use(processImage(config))
                    .use(express['static'](root)),
                'to yield exchange', {
                    request: subject,
                    response: value
                }
            );
        });

    it('should not mess with request for non-image file', function () {
        return expect('GET /something.txt', 'to yield response', {
            headers: {
                'Content-Type': 'text/plain; charset=UTF-8'
            },
            body: 'foo\n'
        });
    });

    it('should not mess with request for image with no query string', function () {
        return expect('GET /ancillaryChunks.png', 'to yield response', {
            headers: {
                'Content-Type': 'image/png'
            },
            body: expect.it('to have length', 3711)
        });
    });

    it('should not mess with request for image with an unsupported operation in the query string', function () {
        return expect('GET /ancillaryChunks.png?foo=bar', 'to yield response', {
            headers: {
                'Content-Type': 'image/png'
            },
            body: expect.it('to have length', 3711)
        });
    });

    it('refuses to process an image whose dimensions exceed maxInputPixels', function () {
        config.maxInputPixels = 100000;
        return expect('GET /hugearea.png?resize=100,100', 'to yield response', 413);
    });

    it('should run the image through pngcrush when the pngcrush CGI param is specified', function () {
        return expect('GET /ancillaryChunks.png?pngcrush=-rem+alla', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'image/png'
            },
            body: expect.it('to have metadata satisfying', {
                format: 'PNG',
                size: {
                    width: 400,
                    height: 20
                }
            }).and('to satisfy', function (body) {
                expect(body.length, 'to be within', 1, 3711);
            })
        });
    });

    it('should run the image through pngquant when the pngquant CGI param is specified', function () {
        return expect('GET /purplealpha24bit.png?pngquant', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'image/png'
            },
            body: expect.it('to have metadata satisfying', {
                format: 'PNG',
                size: {
                    width: 100,
                    height: 100
                }
            }).and('to satisfy', function (body) {
                expect(body.length, 'to be within', 1, 8285);
            })
        });
    });

    it('should run the image through jpegtran when the jpegtran CGI param is specified', function () {
        return expect('GET /turtle.jpg?jpegtran=-grayscale,-flip,horizontal', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'image/jpeg'
            },
            body: expect.it('to have metadata satisfying', {
                format: 'JPEG',
                'Channel Depths': {
                    Gray: '8 bits'
                },
                size: {
                    width: 481,
                    height: 424
                }
            }).and('to satisfy', function (body) {
                expect(body.length, 'to be within', 1, 105836);
            })
        });
    });

    it('should run the image through graphicsmagick when methods exposed by the gm module are added as CGI params', function () {
        return expect('GET /turtle.jpg?gm&resize=340,300', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'image/jpeg'
            },
            body: expect.it('to have metadata satisfying', {
                format: 'JPEG',
                size: {
                    width: 340,
                    height: 300
                }
            }).and('to satisfy', function (body) {
                expect(body.length, 'to be within', 1, 105836);
                expect(body.slice(0, 10), 'to equal', new Buffer([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));
            })
        });
    });

    it('should run the image through sharp when methods exposed by the sharp module are added as CGI params', function () {
        return expect('GET /turtle.jpg?sharp&resize=340,300&png', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'image/png'
            },
            body: expect.it('to have metadata satisfying', {
                format: 'PNG',
                size: {
                    width: 340,
                    height: 300
                }
            })
        });
    });

    it('should run the image through svgfilter when the svgfilter parameter is specified', function () {
        return expect('GET /dialog-information.svg?svgfilter=--runScript=addBogusElement.js,--bogusElementId=theBogusElementId', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'image/svg+xml',
                ETag: /"\d+-\d+-processimage"$/
            },
            body: expect.it('to match', /<svg/)
                .and('to match', /id="theBogusElementId"/)
        }).then(function (context) {
            var etag = context.httpResponse.headers.get('ETag');
            return expect({
                url: 'GET /dialog-information.svg?svgfilter=--runScript=addBogusElement.js,--bogusElementId=theBogusElementId',
                headers: {
                    'If-None-Match': etag
                }
            }, 'to yield response', {
                statusCode: 304,
                headers: {
                    ETag: etag
                }
            });
        });
    });

    it('should run the image through multiple filters when multiple CGI params are specified', function () {
        return expect('GET /purplealpha24bit.png?resize=800,800&pngquant=8&pngcrush=-rem,gAMA', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'image/png'
            },
            body: expect.it('when decoded as', 'ascii', 'not to match', /gAMA/)
                .and('to satisfy', function (body) {
                    expect(body.length, 'to be greater than', 0);
                })
                .and('to have metadata satisfying', {
                    format: 'PNG',
                    size: {
                        width: 800,
                        height: 800
                    }
                })
        });
    });

    it('should serve a converted image with the correct Content-Type', function () {
        return expect('GET /purplealpha24bit.png?setFormat=jpg', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'image/jpeg',
                ETag: /-processimage/
            },
            body: expect.it('when decoded as', 'ascii', 'not to match', /gAMA/)
                .and('to satisfy', function (body) {
                    expect(body.length, 'to be greater than', 0);
                })
                .and('to have metadata satisfying', {
                    format: 'JPEG',
                    size: {
                        width: 100,
                        height: 100
                    }
                })
        }).then(function (context) {
            var etag = context.httpResponse.headers.get('ETag');
            return expect({
                url: 'GET /purplealpha24bit.png?setFormat=jpg',
                headers: {
                    'If-None-Match': etag
                }
            }, 'to yield response', {
                statusCode: 304,
                headers: {
                    ETag: etag
                }
            });
        });
    });

    it('should serve an error response if an invalid image is processed with GraphicsMagick', function () {
        return expect('GET /invalidImage.png?setFormat=jpg', 'to yield response', {
            errorPassedToNext: true
        });
    });

    it('should serve an error response if an invalid image is processed with pngquant', function () {
        return expect('GET /invalidImage.png?pngquant', 'to yield response', {
            errorPassedToNext: true
        });
    });

    it('should include the command line in the response body when an error is encountered', function () {
        // TODO: This test results in a statusCode 404. That is weird...
        return expect('GET /notajpeg.jpg?jpegtran=-grayscale', 'to yield response', {
            errorPassedToNext: /jpegtran -grayscale:/
        });
    });

    // Undetectable by gm -- the source format must be explicitly specified
    it('should convert an icon to png via GraphicsMagick', function () {
        return expect('GET /favicon.ico?gm&png', 'to yield response', {
            headers: {
                'Content-Type': 'image/png'
            },
            body: expect.it('to have metadata satisfying', {
                format: 'PNG',
                size: {
                    width: 16,
                    height: 16
                }
            })
        });
    });

    it('should convert an icon served as image/vnd.microsoft.icon to png via GraphicsMagick', function () {
        return expect(express().use(processImage(config)).get('/favicon.ico', function (req, res, next) {
            res.setHeader('Content-Type', 'image/vnd.microsoft.icon');
            fs.createReadStream(pathModule.resolve(__dirname, '..', 'testdata', 'favicon.ico')).pipe(res);
        }), 'to yield exchange', {
            request: 'GET /favicon.ico?gm&png',
            response: {
                headers: {
                    'Content-Type': 'image/png'
                },
                body: expect.it('to have metadata satisfying', {
                    format: 'PNG',
                    size: {
                        width: 16,
                        height: 16
                    }
                })
            }
        });
    });

    describe.skipIf(!sharp, 'when sharp is available', function () {
        it('should allow retrieving the image metadata as JSON', function () {
            return expect('GET /turtle.jpg?metadata', 'to yield response', {
                body: {
                    contentType: 'image/jpeg',
                    filesize: 105836,
                    etag: /^W\//,
                    width: 481,
                    height: 424,
                    space: 'srgb',
                    channels: 3,
                    hasProfile: false,
                    hasAlpha: false
                }
            });
        });

        it('should allow retrieving the image metadata for the result of an operation', function () {
            return expect('GET /turtle.jpg?png&greyscale&resize=10&metadata', 'to yield response', {
                body: {
                    width: 10,
                    height: 9,
                    space: 'srgb',
                    channels: 3,
                    hasProfile: false,
                    hasAlpha: false
                }
            });
        });

        it('should include the EXIF data in the image metadata', function () {
            return expect('GET /exifOriented.jpg?metadata', 'to yield response', {
                body: {
                    image: {
                        Make: 'Apple',
                        Model: 'iPhone 6'
                    },
                    exif: {
                        ExposureTime: 0.025
                    }
                }
            });
        });

        it('should parse the ICC Profile data if available', function () {
            return expect('GET /Landscape_8.jpg?metadata', 'to yield response', {
                body: {
                    icc: {
                        deviceClass: 'Monitor',
                        colorSpace: 'RGB'
                        // etc.
                    }
                }
            });
        });

        it('should send back an error when ?metadata is applied to a non-image', function () {
            return expect('GET /certainlynotanimage.jpg?metadata', 'to yield response', 415);
        });

        it('should allow a crop operation with the gravity specified as a string', function () {
            return expect('GET /turtle.jpg?resize=40,15&crop=north', 'to yield response', {
                body: expect.it('to resemble', pathModule.resolve(__dirname, '..', 'testdata', 'turtleCroppedNorth.jpg'))
            });
        });
    });
});
