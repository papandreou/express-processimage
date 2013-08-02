var express = require('express'),
    Path = require('path'),
    request = require('request'),
    passError = require('passerror'),
    expect = require('expect.js'),
    processImage = require('../lib/processImage'),
    Stream = require('stream'),
    gm = require('gm');

function getImageMetadataFromBuffer(buffer, cb) {
    var readStream = new Stream();
    readStream.readable = true;
    gm(readStream).identify(cb);
    process.nextTick(function () {
        readStream.emit('data', buffer);
        readStream.emit('end');
    });
}

describe('test server', function () {
    // Pick a random TCP port above 10000 (.listen(0) doesn't work anymore?)
    var portNumber = 10000 + Math.floor(55536 * Math.random()),
        baseUrl = 'http://127.0.0.1:' + portNumber,
        server;

    before(function (done) {
        var root = Path.resolve(__dirname, 'root') + '/';
        server = express()
            .use(processImage({root: root}))
            .use(express.static(root))
            .use(function errorHandler(err, req, res, next) {
                res.writeHead(500, {
                    'content-type': 'text/plain'
                });
                res.end(err.stack || err);
            })
            .listen(portNumber, done);
    });

    after(function () {
        server.close();
    });

    it('should not mess with request for non-image file', function (done) {
        request(baseUrl + '/something.txt', passError(done, function (response, body) {
            expect(body).to.equal("foo\n");
            expect(response.headers['content-type']).to.equal('text/plain; charset=UTF-8');
            done();
        }));
    });

    it('should not mess with request for image with no query string', function (done) {
        request({url: baseUrl + '/ancillaryChunks.png', encoding: null}, passError(done, function (response, body) {
            expect(body.length).to.equal(152);
            expect(response.headers['content-type']).to.equal('image/png');
            done();
        }));
    });

    it('should not mess with request for image with an unsupported operation in the query string', function (done) {
        request({url: baseUrl + '/ancillaryChunks.png?foo=bar', encoding: null}, passError(done, function (response, body) {
            expect(body.length).to.equal(152);
            expect(response.headers['content-type']).to.equal('image/png');
            done();
        }));
    });

    it('should run the image through pngcrush when the pngcrush CGI param is specified', function (done) {
        request({url: baseUrl + '/ancillaryChunks.png?pngcrush=-rem+alla', encoding: null}, passError(done, function (response, body) {
            expect(response.statusCode).to.equal(200);
            expect(response.headers['content-type']).to.equal('image/png');
            expect(body.length).to.be.lessThan(152);
            expect(body.length).to.be.greaterThan(0);
            getImageMetadataFromBuffer(body, passError(done, function (metadata) {
                expect(metadata.format).to.equal('PNG');
                expect(metadata.size.width).to.equal(12);
                expect(metadata.size.height).to.equal(5);
                done();
            }));
        }));
    });

    it('should run the image through pngquant when the pngquant CGI param is specified', function (done) {
        request({url: baseUrl + '/purplealpha24bit.png?pngquant', encoding: null}, passError(done, function (response, body) {
            expect(response.statusCode).to.equal(200);
            expect(response.headers['content-type']).to.equal('image/png');
            expect(body.length).to.be.lessThan(8285);
            expect(body.length).to.be.greaterThan(0);
            getImageMetadataFromBuffer(body, passError(done, function (metadata) {
                expect(metadata.format).to.equal('PNG');
                expect(metadata.size.width).to.equal(100);
                expect(metadata.size.height).to.equal(100);
                done();
            }));
        }));
    });

    it('should run the image through jpegtran when the jpegtran CGI param is specified', function (done) {
        request({url: baseUrl + '/turtle.jpg?jpegtran=-grayscale,-flip,horizontal', encoding: null}, passError(done, function (response, body) {
            expect(response.statusCode).to.equal(200);
            expect(response.headers['content-type']).to.equal('image/jpeg');
            expect(body.length).to.be.lessThan(105836);
            expect(body.length).to.be.greaterThan(0);
            getImageMetadataFromBuffer(body, passError(done, function (metadata) {
                expect(metadata.format).to.equal('JPEG');
                expect(metadata.size.width).to.equal(481);
                expect(metadata.size.height).to.equal(424);
                expect(metadata['Channel Depths'].Gray).to.equal('8 bits');
                done();
            }));
        }));
    });

    it('should run the image through graphicsmagick when methods exposed by the gm module are added as CGI params', function (done) {
        request({url: baseUrl + '/turtle.jpg?resize=340,300', encoding: null}, passError(done, function (response, body) {
            expect(response.statusCode).to.equal(200);
            expect(response.headers['content-type']).to.equal('image/jpeg');
            expect(body.slice(0, 10).toString()).to.equal(new Buffer([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString());
            expect(body.length).to.be.lessThan(105836);
            expect(body.length).to.be.greaterThan(0);
            getImageMetadataFromBuffer(body, passError(done, function (metadata) {
                expect(metadata.format).to.equal('JPEG');
                expect(metadata.size.width).to.equal(340);
                expect(metadata.size.height).to.equal(300);
                done();
            }));
        }));
    });

    it('should run the image through svgfilter when the svgfilter parameter is specified', function (done) {
        request({url: baseUrl + '/dialog-information.svg?svgfilter=--runScript=addBogusElement.js,--bogusElementId=theBogusElementId'}, passError(done, function (response, svgText) {
            expect(response.statusCode).to.equal(200);
            expect(response.headers['content-type']).to.equal('image/svg+xml');
            expect(svgText).to.match(/<svg/);
            expect(svgText).to.match(/id="theBogusElementId"/);
            done();
        }));
    });

    it('should run the image through multiple filters when multiple CGI params are specified', function (done) {
        request({url: baseUrl + '/purplealpha24bit.png?resize=800,800&pngquant=8&pngcrush=-rem,gAMA', encoding: null}, passError(done, function (response, body) {
            expect(response.statusCode).to.equal(200);
            expect(response.headers['content-type']).to.equal('image/png');
            expect(body.length).to.be.greaterThan(0);
            expect(body.toString('ascii')).not.to.match(/gAMA/);
            getImageMetadataFromBuffer(body, passError(done, function (metadata) {
                expect(metadata.format).to.equal('PNG');
                expect(metadata.size.width).to.equal(800);
                expect(metadata.size.height).to.equal(800);
                done();
            }));
        }));
    });

    it('should serve a converted image with the correct Content-Type', function (done) {
        request({url: baseUrl + '/purplealpha24bit.png?setFormat=jpg', encoding: null}, passError(done, function (response, body) {
            expect(response.statusCode).to.equal(200);
            expect(response.headers['content-type']).to.equal('image/jpeg');
            expect(body.length).to.be.greaterThan(0);
            expect(body.toString('ascii')).not.to.match(/gAMA/);
            getImageMetadataFromBuffer(body, passError(done, function (metadata) {
                expect(metadata.format).to.equal('JPEG');
                expect(metadata.size.width).to.equal(100);
                expect(metadata.size.height).to.equal(100);
                var etag = response.headers.etag;
                expect(typeof etag).to.equal('string');
                expect(etag).to.match(/-processimage/);
                request({
                    url: baseUrl + '/purplealpha24bit.png?setFormat=jpg',
                    encoding: null,
                    headers: {
                        'if-none-match': etag
                    }
                }, passError(done, function (response2, body2) {
                    expect(response2.statusCode).to.equal(304);
                    done();
                }));
            }));
        }));
    });

    it('should serve an error response if an invalid image is processed with GraphicsMagick', function (done) {
        request({url: baseUrl + '/invalidImage.png?setFormat=jpg', encoding: null}, passError(done, function (response, body) {
            expect(response.statusCode).to.be.greaterThan(399);
            done();
        }));
    });

    it('should serve an error response if an invalid image is processed with pngquant', function (done) {
        request({url: baseUrl + '/invalidImage.png?pngquant', encoding: null}, passError(done, function (response, body) {
            expect(response.statusCode).to.be.greaterThan(399);
            done();
        }));
    });
});
