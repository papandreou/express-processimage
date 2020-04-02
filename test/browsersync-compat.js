const bs = require('browser-sync').create();
const expect = require('unexpected').clone();
const pathModule = require('path');
const root = `${pathModule.resolve(__dirname, '..', 'testdata')}/`;
const processImage = require('../lib/processImage');

const serverPort = '9999';

expect.use(require('unexpected-http')).use(require('unexpected-image'));

describe('browser-sync compatibility', () => {
  before((done) => {
    bs.init(
      {
        port: serverPort,
        server: root,
        open: false,
        logLevel: 'silent',
        middleware: [processImage({ root })],
      },
      done
    );
  });

  after(() => {
    bs.exit();
  });

  it('should not mess with request for non-image file', () =>
    expect(
      `GET http://localhost:${serverPort}/something.txt`,
      'to yield response',
      {
        headers: {
          'Content-Type': 'text/plain; charset=UTF-8',
        },
        body: 'foo\n',
      }
    ));

  it('should not mess with request for image with no query string', () =>
    expect(
      `GET http://localhost:${serverPort}/ancillaryChunks.png`,
      'to yield response',
      {
        headers: {
          'Content-Type': 'image/png',
        },
        body: expect.it('to have length', 3711),
      }
    ));

  it('should not mess with request for image with an unsupported operation in the query string', () =>
    expect(
      `GET http://localhost:${serverPort}/ancillaryChunks.png?foo=bar`,
      'to yield response',
      {
        headers: {
          'Content-Type': 'image/png',
        },
        body: expect.it('to have length', 3711),
      }
    ));

  it('should return a 304 status code when requesting the same image with unchanged modifications', () =>
    expect(
      `GET http://localhost:${serverPort}/ancillaryChunks.png?foo=bar`,
      'to yield response',
      {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/png',
        },
        body: expect.it('to have length', 3711),
      }
    ).then((context) => {
      const etag = context.httpResponse.headers.get('ETag');
      return expect(
        {
          url: `GET http://localhost:${serverPort}/ancillaryChunks.png?foo=bar`,
          headers: {
            'If-None-Match': etag,
          },
        },
        'to yield response',
        {
          statusCode: 304,
          headers: expect.it('to be empty'),
          body: expect.it('to be', ''),
        }
      );
    }));

  it('should run the image through pngcrush when the pngcrush CGI param is specified', () =>
    expect(
      `GET http://localhost:${serverPort}/ancillaryChunks.png?pngcrush=-rem+alla`,
      'to yield response',
      {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/png',
        },
        body: expect
          .it('to have metadata satisfying', {
            format: 'PNG',
            size: {
              width: 400,
              height: 20,
            },
          })
          .and((body) => {
            expect(body.length, 'to be within', 1, 3711);
          }),
      }
    ));
});
