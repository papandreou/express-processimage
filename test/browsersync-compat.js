/*global describe, it, before, after*/
var bs = require('browser-sync').create();
var expect = require('unexpected').clone();
var pathModule = require('path');
var root = pathModule.resolve(__dirname, '..', 'testdata') + '/';
var processImage = require('../lib/processImage');

expect.use(require('unexpected-http'))
    .use(require('unexpected-image'))
    .use(require('unexpected-resemble'))
    .use(require('unexpected-sinon'))
    .use(require('magicpen-prism'))
    .addAssertion('<string> to respond with <object|number>', function (expect, subject, value) {
        var modifiedSubject = subject.replace(' ', ' http://localhost:9999');
        return expect(modifiedSubject, 'to yield response', value);
    });

before(function (done) {
    bs.init({
        port: '9999',
        server: root,
        open: false,
        logLevel: 'silent',
        middleware: [
            processImage({ root: root })
        ]
    }, done);
});

after(function () {
    bs.exit();
});

describe('browser-sync compatibility', function () {
    it('should not mess with request for non-image file', function () {
        return expect('GET /something.txt', 'to respond with', {
            headers: {
                'Content-Type': 'text/plain; charset=UTF-8'
            },
            body: 'foo\n'
        });
    });

    it('should not mess with request for image with no query string', function () {
        return expect('GET /ancillaryChunks.png', 'to respond with', {
            headers: {
                'Content-Type': 'image/png'
            },
            body: expect.it('to have length', 3711)
        });
    });

    it('should not mess with request for image with an unsupported operation in the query string', function () {
        return expect('GET /ancillaryChunks.png?foo=bar', 'to respond with', {
            headers: {
                'Content-Type': 'image/png'
            },
            body: expect.it('to have length', 3711)
        });
    });

    it('should run the image through pngcrush when the pngcrush CGI param is specified', function () {
        return expect('GET /ancillaryChunks.png?pngcrush=-rem+alla', 'to respond with', {
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
});
