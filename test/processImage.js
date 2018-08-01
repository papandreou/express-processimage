/*global describe, it, beforeEach, afterEach, __dirname*/
var express = require('express');

var fs = require('fs');

var http = require('http');

var pathModule = require('path');

var unexpected = require('unexpected');

var sinon = require('sinon');

var Stream = require('stream');

var processImage = require('../lib/processImage');

var root = pathModule.resolve(__dirname, '..', 'testdata') + '/';

var sharp = require('sharp');

describe('express-processimage', function() {
  var config;
  var sandbox;
  beforeEach(function() {
    config = { root: root, filters: {} };
    sandbox = sinon.createSandbox();
  });

  afterEach(function() {
    sandbox.restore();
  });

  var expect = unexpected
    .clone()
    .use(require('unexpected-express'))
    .use(require('unexpected-http'))
    .use(require('unexpected-image'))
    .use(require('unexpected-resemble'))
    .use(require('unexpected-sinon'))
    .use(require('magicpen-prism'))
    .addAssertion('<string|object> to yield response <object|number>', function(
      expect,
      subject,
      value
    ) {
      return expect(
        express()
          .use(processImage(config))
          .use(express.static(root)),
        'to yield exchange',
        {
          request: subject,
          response: value
        }
      );
    })
    .addAssertion('<Buffer> [when] converted to PNG <assertion>', function(
      expect,
      subject
    ) {
      expect.errorMode = 'bubble';
      return sharp(subject)
        .png()
        .toBuffer()
        .then(function(pngBuffer) {
          return expect.shift(pngBuffer);
        });
    });

  it('should not mess with request for non-image file', function() {
    return expect('GET /something.txt', 'to yield response', {
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8'
      },
      body: 'foo\n'
    });
  });

  it('should not mess with request for image with no query string', function() {
    return expect('GET /ancillaryChunks.png', 'to yield response', {
      headers: {
        'Content-Type': 'image/png'
      },
      body: expect.it('to have length', 3711)
    });
  });

  it('should not mess with request for image with an unsupported operation in the query string', function() {
    return expect('GET /ancillaryChunks.png?foo=bar', 'to yield response', {
      headers: {
        'Content-Type': 'image/png'
      },
      body: expect.it('to have length', 3711)
    });
  });

  it('refuses to process an image whose dimensions exceed maxInputPixels', function() {
    config.maxInputPixels = 100000;
    return expect('GET /hugearea.png?resize=100,100', 'to yield response', 413);
  });

  describe('with the sharp engine', function() {
    it('should resize by specifying a bounding box', function() {
      return expect('GET /turtle.jpg?resize=500,1000', 'to yield response', {
        body: expect.it('to have metadata satisfying', {
          size: {
            width: 500,
            height: 441
          }
        })
      });
    });

    describe('when omitting the height', function() {
      it('should do a proportional resize to the given width', function() {
        return expect('GET /turtle.jpg?resize=500,', 'to yield response', {
          body: expect.it('to have metadata satisfying', {
            size: {
              width: 500,
              height: 441
            }
          })
        });
      });

      describe('without a trailing comma', function() {
        it('should do a proportional resize to the given width', function() {
          return expect('GET /turtle.jpg?resize=500', 'to yield response', {
            body: expect.it('to have metadata satisfying', {
              size: {
                width: 500,
                height: 441
              }
            })
          });
        });
      });

      describe('with a maxOutputPixels setting in place', function() {
        it('should limit the size of the bounding box based on the maxOutputPixels value', function() {
          config.maxOutputPixels = 250000;
          return expect('GET /turtle.jpg?resize=2000,', 'to yield response', {
            body: expect.it('to have metadata satisfying', {
              size: {
                width: 142,
                height: 125
              }
            })
          });
        });
      });
    });

    describe('when omitting the width', function() {
      it('should do a proportional resize to the given height', function() {
        return expect('GET /turtle.jpg?resize=,500', 'to yield response', {
          body: expect.it('to have metadata satisfying', {
            size: {
              width: 567,
              height: 500
            }
          })
        });
      });

      describe('with a maxOutputPixels setting in place', function() {
        it('should limit the size of the bounding box based on the maxOutputPixels value', function() {
          config.maxOutputPixels = 250000;
          return expect('GET /turtle.jpg?resize=,2000', 'to yield response', {
            body: expect.it('to have metadata satisfying', {
              size: {
                width: 125,
                height: 110
              }
            })
          });
        });
      });
    });

    it('should do an entropy-based crop', function() {
      return expect(
        'GET /turtle.jpg?resize=100,200&crop=entropy',
        'to yield response',
        {
          body: expect
            .it(
              'to resemble',
              pathModule.resolve(
                __dirname,
                '..',
                'testdata',
                'turtleCroppedEntropy100x200.jpg'
              )
            )
            .and('to have metadata satisfying', {
              size: {
                width: 100,
                height: 200
              }
            })
        }
      );
    });

    it('should do an attention-based crop', function() {
      return expect(
        'GET /turtle.jpg?resize=100,200&crop=attention',
        'to yield response',
        {
          body: expect
            .it(
              'to resemble',
              pathModule.resolve(
                __dirname,
                '..',
                'testdata',
                'turtleCroppedAttention100x200.jpg'
              )
            )
            .and('to have metadata satisfying', {
              size: {
                width: 100,
                height: 200
              }
            })
        }
      );
    });

    // https://github.com/papandreou/express-processimage/issues/23
    describe('when the quality and progressiveness of the image is being adjusted', function() {
      it('should work and not log deprecation warnings when there is no explicit conversion', function() {
        sandbox.spy(console, 'error');
        return expect(
          'GET /turtle.jpg?quality=10&progressive',
          'to yield response',
          {
            body: expect.it('to have metadata satisfying', {
              size: {
                width: 481,
                height: 424
              },
              Interlace: 'Line',
              Filesize: expect
                .it('to match', /Ki?$/)
                .and(
                  'when passed as parameter to',
                  parseFloat,
                  'to be less than',
                  10
                )
            })
          }
        ).then(() =>
          expect(console.error, 'to have no calls satisfying', () =>
            console.error(/DeprecationWarning/)
          )
        );
      });

      it('should work and not log deprecation warnings when there is an explicit conversion', function() {
        sandbox.spy(console, 'error');
        return expect(
          'GET /turtle.jpg?jpeg&quality=10&progressive',
          'to yield response',
          {
            body: expect.it('to have metadata satisfying', {
              size: {
                width: 481,
                height: 424
              },
              Interlace: 'Line',
              Filesize: expect
                .it('to match', /Ki?$/)
                .and(
                  'when passed as parameter to',
                  parseFloat,
                  'to be less than',
                  10
                )
            })
          }
        ).then(() =>
          expect(console.error, 'to have no calls satisfying', () =>
            console.error(/DeprecationWarning/)
          )
        );
      });
    });
  });

  describe('with the sharp engine', function() {
    it('should resize by specifying a bounding box', function() {
      return expect(
        'GET /turtle.jpg?sharp&resize=500,1000',
        'to yield response',
        {
          body: expect.it('to have metadata satisfying', {
            size: {
              width: 500,
              height: 441
            }
          })
        }
      );
    });
  });

  it('should run the image through pngcrush when the pngcrush CGI param is specified', function() {
    return expect(
      'GET /ancillaryChunks.png?pngcrush=-rem+alla',
      'to yield response',
      {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/png'
        },
        body: expect
          .it('to have metadata satisfying', {
            format: 'PNG',
            size: {
              width: 400,
              height: 20
            }
          })
          .and('to satisfy', function(body) {
            expect(body.length, 'to be within', 1, 3711);
          })
      }
    );
  });

  it('should run the image through pngquant when the pngquant CGI param is specified', function() {
    return expect('GET /purplealpha24bit.png?pngquant', 'to yield response', {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/png'
      },
      body: expect
        .it('to have metadata satisfying', {
          format: 'PNG',
          size: {
            width: 100,
            height: 100
          }
        })
        .and('to satisfy', function(body) {
          expect(body.length, 'to be within', 1, 8285);
        })
    });
  });

  it('should run the image through jpegtran when the jpegtran CGI param is specified', function() {
    return expect(
      'GET /turtle.jpg?jpegtran=-grayscale,-flip,horizontal',
      'to yield response',
      {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/jpeg'
        },
        body: expect
          .it('to have metadata satisfying', {
            format: 'JPEG',
            'Channel Depths': {
              Gray: '8 bits'
            },
            size: {
              width: 481,
              height: 424
            }
          })
          .and('to satisfy', function(body) {
            expect(body.length, 'to be within', 1, 105836);
          })
      }
    );
  });

  it('should run the image through graphicsmagick when methods exposed by the gm module are added as CGI params', function() {
    return expect('GET /turtle.jpg?gm&resize=340,300', 'to yield response', {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/jpeg'
      },
      body: expect
        .it('to have metadata satisfying', {
          format: 'JPEG',
          size: {
            width: 340,
            height: 300
          }
        })
        .and('to satisfy', function(body) {
          expect(body.length, 'to be within', 1, 105836);
          expect(
            body.slice(0, 10),
            'to equal',
            new Buffer([
              0xff,
              0xd8,
              0xff,
              0xe0,
              0x00,
              0x10,
              0x4a,
              0x46,
              0x49,
              0x46
            ])
          );
        })
    });
  });

  it('should run the image through sharp when methods exposed by the sharp module are added as CGI params', function() {
    return expect(
      'GET /turtle.jpg?sharp&resize=340,300&png',
      'to yield response',
      {
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
      }
    );
  });

  it('should run the image through svgfilter when the svgfilter parameter is specified', function() {
    return expect(
      'GET /dialog-information.svg?svgfilter=--runScript=addBogusElement.js,--bogusElementId=theBogusElementId',
      'to yield response',
      {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          ETag: /"\w+-\w+-processimage"$/
        },
        body: expect
          .it('to match', /<svg/)
          .and('to match', /id="theBogusElementId"/)
      }
    ).then(function(context) {
      var etag = context.httpResponse.headers.get('ETag');
      return expect(
        {
          url:
            'GET /dialog-information.svg?svgfilter=--runScript=addBogusElement.js,--bogusElementId=theBogusElementId',
          headers: {
            'If-None-Match': etag
          }
        },
        'to yield response',
        {
          statusCode: 304,
          headers: {
            ETag: etag
          }
        }
      );
    });
  });

  it('should run the image through multiple filters when multiple CGI params are specified', function() {
    return expect(
      'GET /purplealpha24bit.png?resize=800,800&pngquant=8&pngcrush=-rem,gAMA',
      'to yield response',
      {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/png'
        },
        body: expect
          .it('when decoded as', 'ascii', 'not to match', /gAMA/)
          .and('to satisfy', function(body) {
            expect(body.length, 'to be greater than', 0);
          })
          .and('to have metadata satisfying', {
            format: 'PNG',
            size: {
              width: 800,
              height: 800
            }
          })
      }
    );
  });

  it('should serve a converted image with the correct Content-Type', function() {
    return expect(
      'GET /purplealpha24bit.png?setFormat=jpg',
      'to yield response',
      {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          ETag: /-processimage/
        },
        body: expect
          .it('when decoded as', 'ascii', 'not to match', /gAMA/)
          .and('to satisfy', function(body) {
            expect(body.length, 'to be greater than', 0);
          })
          .and('to have metadata satisfying', {
            format: 'JPEG',
            size: {
              width: 100,
              height: 100
            }
          })
      }
    ).then(function(context) {
      var etag = context.httpResponse.headers.get('ETag');
      return expect(
        {
          url: 'GET /purplealpha24bit.png?setFormat=jpg',
          headers: {
            'If-None-Match': etag
          }
        },
        'to yield response',
        {
          statusCode: 304,
          headers: {
            ETag: etag
          }
        }
      );
    });
  });

  it('should serve an error response if an invalid image is processed with GraphicsMagick', function() {
    return expect('GET /invalidImage.png?setFormat=jpg', 'to yield response', {
      errorPassedToNext: true
    });
  });

  it('should serve an error response if an invalid image is processed with pngquant', function() {
    return expect('GET /invalidImage.png?pngquant', 'to yield response', {
      errorPassedToNext: true
    });
  });

  it('should include the command line in the response body when an error is encountered', function() {
    // TODO: This test results in a statusCode 404. That is weird...
    return expect(
      'GET /notajpeg.jpg?jpegtran=-grayscale',
      'to yield response',
      {
        errorPassedToNext: /jpegtran -grayscale:/
      }
    );
  });

  // Undetectable by gm -- the source format must be explicitly specified
  it('should convert an icon to png via GraphicsMagick', function() {
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

  it('should convert an icon served as image/vnd.microsoft.icon to png via GraphicsMagick', function() {
    return expect(
      express()
        .use(processImage(config))
        .get('/favicon.ico', function(req, res, next) {
          res.setHeader('Content-Type', 'image/vnd.microsoft.icon');
          fs.createReadStream(
            pathModule.resolve(__dirname, '..', 'testdata', 'favicon.ico')
          ).pipe(res);
        }),
      'to yield exchange',
      {
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
      }
    );
  });

  describe('with an allowOperation option', function() {
    beforeEach(function() {
      config.allowOperation = sandbox
        .spy(function(keyValue) {
          return keyValue !== 'png';
        })
        .named('allowOperation');
    });

    it('should allow an operation for which allowOperation returns true', function() {
      return expect('GET /turtle.jpg?resize=87,100', 'to yield response', {
        headers: {
          'Content-Type': 'image/jpeg'
        },
        body: expect.it('to have metadata satisfying', { size: { width: 87 } })
      }).then(function() {
        expect(config.allowOperation, 'to have calls satisfying', function() {
          config.allowOperation('resize', [87, 100]);
        });
      });
    });

    it('should disallow an operation for which allowOperation returns false', function() {
      return expect('GET /turtle.jpg?png', 'to yield response', {
        headers: {
          'Content-Type': 'image/jpeg'
        },
        body: expect.it('to have metadata satisfying', {
          format: 'JPEG'
        })
      }).then(function() {
        expect(config.allowOperation, 'to have calls satisfying', function() {
          config.allowOperation('png', []);
        });
      });
    });
  });

  describe('with the sharp engine', function() {
    // https://github.com/lovell/sharp/issues/375#issuecomment-214546310
    it.skip('should process and convert a transparent gif', function() {
      return expect('GET /transparentbw.gif?flip&png', 'to yield response', {
        body: expect.it('to have metadata satisfying', {
          format: 'PNG'
        })
      });
    });

    it('should apply the sharpCache option', function() {
      config.sharpCache = 123;
      var cacheStub = sandbox.stub(sharp, 'cache');
      return expect('GET /turtle.jpg?metadata', 'to yield response', {
        body: {
          contentType: 'image/jpeg'
        }
      }).then(function() {
        expect(cacheStub, 'to have calls satisfying', function() {
          cacheStub(123);
        });
      });
    });

    it('should allow retrieving the image metadata as JSON and support conditional GET', function() {
      return expect('GET /turtle.jpg?metadata', 'to yield response', {
        headers: {
          ETag: expect.it('to be a string')
        },
        body: {
          contentType: 'image/jpeg',
          filesize: 105836,
          etag: expect
            .it('to match', /^W\//)
            .and('not to contain', '-processimage'),
          width: 481,
          height: 424,
          space: 'srgb',
          channels: 3,
          hasProfile: false,
          hasAlpha: false
        }
      }).then(function(context) {
        return expect(
          {
            url: 'GET /turtle.jpg?metadata',
            headers: {
              'If-None-Match': context.httpResponse.headers.get('ETag')
            }
          },
          'to yield response',
          304
        );
      });
    });

    // Regression test
    it('should not break when serving a 304 to a ?metadata request when secondGuessSourceContentType is enabled', function() {
      config.secondGuessSourceContentType = true;
      return expect(
        express()
          .use(processImage(config))
          .use(function(req, res, next) {
            res.status(304).end();
          }),
        'to yield exchange',
        {
          request: {
            url: 'GET /turtle.jpg?metadata',
            headers: {
              'If-None-Match': '"foobar"'
            }
          },
          response: 304
        }
      );
    });

    it('should allow retrieving the metadata of a non-image file with a non-image extension', function() {
      return expect('GET /something.txt?metadata', 'to yield response', {
        body: {
          contentType: 'text/plain; charset=UTF-8',
          filesize: 4,
          etag: expect.it('to be a string')
        }
      });
    });

    it('should allow retrieving the metadata of a non-image file with a non-image extension, even when unlisted in allowedImageSourceContentTypes', function() {
      config.allowedImageSourceContentTypes = ['image/png'];
      return expect('GET /something.txt?metadata', 'to yield response', {
        body: {
          contentType: 'text/plain; charset=UTF-8',
          filesize: 4,
          etag: expect.it('to be a string')
        }
      });
    });

    it('should set animated:true for an animated gif', function() {
      return expect('GET /animated.gif?metadata', 'to yield response', {
        body: {
          animated: true
        }
      });
    });

    it('should set animated:false for a non-animated gif', function() {
      return expect('GET /bulb.gif?metadata', 'to yield response', {
        body: {
          animated: false
        }
      });
    });

    it('should allow support ?metadata=true as well (legacy)', function() {
      return expect('GET /turtle.jpg?metadata=true', 'to yield response', {
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

    it('should allow retrieving the image metadata of a GIF', function() {
      return expect('GET /animated.gif?metadata', 'to yield response', {
        body: {
          format: 'gif',
          contentType: 'image/gif',
          filesize: 362
        }
      });
    });

    it('should allow retrieving the image metadata of a JPEG converted to GIF', function() {
      return expect(
        'GET /turtle.jpg?setFormat=gif&metadata',
        'to yield response',
        {
          body: {
            format: 'gif',
            contentType: 'image/gif'
          }
        }
      );
    });

    it('should allow retrieving the image metadata for the result of an operation', function() {
      return expect(
        'GET /turtle.jpg?png&greyscale&resize=10,9&metadata',
        'to yield response',
        {
          body: {
            width: 10,
            height: 9,
            space: 'srgb',
            channels: 3,
            hasProfile: false,
            hasAlpha: false
          }
        }
      );
    });

    it('should include the EXIF data in the image metadata', function() {
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

    it('should include orientedWidth and orientedHeight properties when the EXIF data specifies an orientation', function() {
      return expect('GET /exifOriented.jpg?metadata', 'to yield response', {
        body: {
          width: 3264,
          height: 2448,
          orientedWidth: 2448,
          orientedHeight: 3264
        }
      });
    });

    it('should auto-orient an image', function() {
      return expect('GET /exifOriented.jpg?rotate', 'to yield response', {
        body: expect.it('to have metadata satisfying', {
          size: {
            width: 2448,
            height: 3264
          }
        })
      });
    });

    // Not yet supported by graphicsmagick (although imagemagick has -auto-orient)
    it.skip('should auto-orient an image with the gm engine', function() {
      config.debug = true;
      return expect('GET /exifOriented.jpg?gm&rotate', 'to yield response', {
        headers: {
          'X-Express-Processimage': 'gm'
        },
        body: expect.it('to have metadata satisfying', {
          size: {
            width: 2448,
            height: 3264
          }
        })
      });
    });

    it('should parse the ICC Profile data if available', function() {
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

    it('should send back the upstream Content-Type and Content-Length when ?metadata is applied to a non-image with an image extension', function() {
      return expect(
        'GET /certainlynotanimage.jpg?metadata',
        'to yield response',
        {
          body: {
            contentType: 'image/jpeg',
            error: 'Input buffer contains unsupported image format',
            filesize: 4,
            etag: expect.it('to be a string')
          }
        }
      );
    });

    it('should send back an error when an operation is applied to a non-image', function() {
      return expect(
        'GET /certainlynotanimage.jpg?resize=10,10',
        'to yield response',
        415
      );
    });

    it('should allow a crop operation with the gravity specified as a string', function() {
      return expect(
        'GET /turtle.jpg?resize=40,15&crop=north',
        'to yield response',
        {
          body: expect.it(
            'to resemble',
            pathModule.resolve(
              __dirname,
              '..',
              'testdata',
              'turtleCroppedNorth.jpg'
            )
          )
        }
      );
    });

    // https://github.com/lovell/sharp/issues/276
    it('should fix the ordering of the parameters to extract to be left,top,width,height', function() {
      return expect(
        'GET /turtle.jpg?extract=40,60,30,40',
        'to yield response',
        {
          body: expect.it(
            'to resemble',
            pathModule.resolve(__dirname, '..', 'testdata', 'turtleExtract.jpg')
          )
        }
      );
    });

    it('should propagate a "bad extract area" error correctly', function() {
      return expect(
        'GET /turtle.jpg?extract=99,99,9999,9999',
        'to yield response',
        {
          errorPassedToNext: /bad extract area/
        }
      );
    });

    it('should convert an animated gif to png', function() {
      return expect('GET /animated.gif?png', 'to yield response', {
        body: expect.it('to have metadata satisfying', {
          format: 'PNG',
          size: {
            width: 23,
            height: 20
          }
        })
      });
    });

    it('should use sharp when a gif is converted to png', function() {
      config.debug = true;
      return expect(
        'GET /animated.gif?resize=40,100&png',
        'to yield response',
        {
          headers: {
            'X-Express-Processimage': 'sharp'
          },
          body: expect.it('to have metadata satisfying', {
            format: 'PNG',
            size: {
              width: 40
            }
          })
        }
      );
    });

    it('should support creating a progressive jpeg', function() {
      config.debug = true;
      return expect(
        'GET /turtle.jpg?resize=100,100&progressive',
        'to yield response',
        {
          body: expect.it('to have metadata satisfying', {
            size: {
              width: 100,
              height: 88
            },
            Interlace: 'Line'
          })
        }
      );
    });

    it('should ignore invalid operations', function() {
      return expect('GET /turtle.jpg?resize=10%22', 'to yield response', {
        body: expect.it('to have metadata satisfying', {
          size: {
            width: 481,
            height: 424
          }
        })
      });
    });
  });

  it('should process a big image when the compression middleware is present above express-processimage', function() {
    return expect(
      express()
        .use(require('compression')())
        .use(processImage())
        .use(express.static(root)),
      'to yield exchange',
      {
        request:
          'GET /the-villa-facade.png?sourceContentType=image%2Fpng&ignoreAspectRatio&resize=652,435&extract=315,10,280,420',
        response: {
          body: expect.it('to have metadata satisfying', {
            format: 'PNG',
            size: {
              width: 280,
              height: 420
            }
          })
        }
      }
    );
  });

  it('should work fine when cropping an item starting from top 0 and left 0', function() {
    return expect('GET /turtle.jpg?extract=0,0,300,200', 'to yield response', {
      body: expect.it(
        'to resemble',
        pathModule.resolve(
          __dirname,
          '..',
          'testdata',
          'turtleCropped300x200FromTopLeft.jpg'
        )
      )
    });
  });

  describe('with the gm engine', function() {
    it('should allow a crop operation with a gravity of center', function() {
      return expect(
        'GET /turtle.jpg?gm&resize=40,15&crop=center',
        'to yield response',
        {
          body: expect.it(
            'to resemble',
            pathModule.resolve(
              __dirname,
              '..',
              'testdata',
              'turtleCroppedCenterGm.jpg'
            )
          )
        }
      );
    });

    it('should allow a crop operation with a gravity of northeast', function() {
      return expect(
        'GET /turtle.jpg?gm&resize=40,15&crop=northeast',
        'to yield response',
        {
          body: expect.it(
            'to resemble',
            pathModule.resolve(
              __dirname,
              '..',
              'testdata',
              'turtleCroppedNorthEastGm.jpg'
            )
          )
        }
      );
    });

    describe('when omitting the height', function() {
      it('should do a proportional resize to the given width', function() {
        return expect('GET /turtle.jpg?gm&resize=500,', 'to yield response', {
          body: expect.it('to have metadata satisfying', {
            size: {
              width: 500,
              height: 441
            }
          })
        });
      });

      describe('with a maxOutputPixels setting in place', function() {
        it('should limit the size of the bounding box based on the maxOutputPixels value', function() {
          config.maxOutputPixels = 250000;
          return expect(
            'GET /turtle.jpg?gm&resize=2000,',
            'to yield response',
            {
              body: expect.it('to have metadata satisfying', {
                size: {
                  width: 142,
                  height: 125
                }
              })
            }
          );
        });
      });
    });

    describe('when omitting the width', function() {
      it('should do a proportional resize to the given height', function() {
        return expect('GET /turtle.jpg?gm&resize=,500', 'to yield response', {
          body: expect.it('to have metadata satisfying', {
            size: {
              width: 567,
              height: 500
            }
          })
        });
      });

      describe('with a maxOutputPixels setting in place', function() {
        it('should limit the size of the bounding box based on the maxOutputPixels value', function() {
          config.maxOutputPixels = 250000;
          return expect(
            'GET /turtle.jpg?gm&resize=,2000',
            'to yield response',
            {
              body: expect.it('to have metadata satisfying', {
                size: {
                  width: 125,
                  height: 110
                }
              })
            }
          );
        });
      });
    });
  });

  describe('with a GIF', function() {
    [true, false].forEach(function(gifsicleAvailable) {
      describe(
        'with gifsicle ' + (gifsicleAvailable ? '' : 'un') + 'available',
        function() {
          beforeEach(function() {
            config.filters.gifsicle = gifsicleAvailable;
            config.debug = true;
          });

          it('should resize an animated gif', function() {
            return expect(
              'GET /animated.gif?resize=40,35',
              'to yield response',
              {
                headers: {
                  'X-Express-Processimage': gifsicleAvailable
                    ? 'gifsicle'
                    : 'gm'
                },
                body: expect.it('to have metadata satisfying', {
                  format: 'GIF',
                  // gifsicle does not enlarge to fill the bounding box
                  // https://github.com/kohler/gifsicle/issues/13#issuecomment-196321546
                  size: gifsicleAvailable
                    ? { width: 23, height: 20 }
                    : { width: 40, height: 35 }
                })
              }
            );
          });

          it('should support the withoutEnlargement modfier', function() {
            return expect(
              'GET /animated.gif?resize=40,35&withoutEnlargement',
              'to yield response',
              {
                headers: {
                  'X-Express-Processimage': gifsicleAvailable
                    ? 'gifsicle'
                    : 'gm'
                },
                body: expect.it('to have metadata satisfying', {
                  format: 'GIF',
                  // gifsicle does not enlarge to fill the bounding box
                  // https://github.com/kohler/gifsicle/issues/13#issuecomment-196321546
                  size: { width: 23, height: 20 }
                })
              }
            );
          });

          it('should support the ignoreAspectRatio modfier', function() {
            return expect(
              'GET /animated.gif?resize=100,100&ignoreAspectRatio',
              'to yield response',
              {
                headers: {
                  'X-Express-Processimage': gifsicleAvailable
                    ? 'gifsicle'
                    : 'gm'
                },
                body: expect.it('to have metadata satisfying', {
                  format: 'GIF',
                  size: { width: 100, height: 100 }
                })
              }
            );
          });

          it('should support resize with crop', function() {
            return expect(
              'GET /animated.gif?resize=40,35&crop=center',
              'to yield response',
              {
                headers: {
                  'X-Express-Processimage': gifsicleAvailable
                    ? 'gifsicle'
                    : 'gm'
                },
                body: expect.it('to have metadata satisfying', {
                  format: 'GIF',
                  // gifsicle does not support cropping to a specific gravity,
                  // so the parameter will be ignored:
                  size: gifsicleAvailable
                    ? { width: 23, height: 20 }
                    : { width: 40, height: 35 }
                })
              }
            );
          });

          it('should resize a non-animated gif', function() {
            return expect('GET /bulb.gif?resize=200,200', 'to yield response', {
              headers: {
                'X-Express-Processimage': gifsicleAvailable ? 'gifsicle' : 'gm'
              },
              body: expect.it('to have metadata satisfying', {
                format: 'GIF',
                size: gifsicleAvailable
                  ? { width: 48, height: 48 }
                  : { width: 200 }
              })
            });
          });

          it('should resize an animated gif with differently sized frames', function() {
            return expect('GET /cat.gif?resize=200,200', 'to yield response', {
              headers: {
                'X-Express-Processimage': gifsicleAvailable ? 'gifsicle' : 'gm'
              },
              body: expect.it('to have metadata satisfying', {
                format: 'GIF',
                size: gifsicleAvailable
                  ? { width: 141, height: 104 }
                  : { width: 200 }
              })
            });
          });

          it('should support extract and rotate', function() {
            return expect(
              'GET /bulb.gif?extract=10,10,15,15',
              'to yield response',
              {
                headers: {
                  'X-Express-Processimage': gifsicleAvailable
                    ? 'gifsicle'
                    : 'gm'
                },
                body: expect
                  .it('to have metadata satisfying', {
                    format: 'GIF',
                    size: {
                      width: 15,
                      height: 15
                    }
                  })
                  .and(
                    'to resemble',
                    pathModule.resolve(
                      __dirname,
                      '..',
                      'testdata',
                      'croppedBulb.gif'
                    )
                  )
              }
            );
          });

          it('should support rotate with a single argument', function() {
            return expect('GET /bulb.gif?rotate=90', 'to yield response', {
              headers: {
                'X-Express-Processimage': gifsicleAvailable ? 'gifsicle' : 'gm'
              },
              body: expect
                .it('to have metadata satisfying', {
                  format: 'GIF',
                  size: {
                    width: 48,
                    height: 48
                  }
                })
                .and(
                  'when converted to PNG to resemble',
                  pathModule.resolve(
                    __dirname,
                    '..',
                    'testdata',
                    'rotatedBulb.png'
                  )
                )
            });
          });

          it('should support generating a progressive (interlaced) GIF', function() {
            return expect(
              'GET /bulb.gif?rotate=90&progressive',
              'to yield response',
              {
                headers: {
                  'X-Express-Processimage': gifsicleAvailable
                    ? 'gifsicle'
                    : 'gm'
                },
                body: expect
                  .it('to have metadata satisfying', {
                    format: 'GIF',
                    size: {
                      width: 48,
                      height: 48
                    },
                    Interlace: 'Line'
                  })
                  .and(
                    'when converted to PNG to resemble',
                    pathModule.resolve(
                      __dirname,
                      '..',
                      'testdata',
                      'rotatedBulb.png'
                    )
                  )
              }
            );
          });

          describe('when omitting the width', function() {
            it('should do a proportional resize to the given height', function() {
              return expect('GET /bulb.gif?resize=20,', 'to yield response', {
                body: expect.it('to have metadata satisfying', {
                  size: {
                    width: 20,
                    height: 20
                  }
                })
              });
            });

            describe('with a maxOutputPixels setting in place', function() {
              it('should limit the size of the bounding box based on the maxOutputPixels value', function() {
                config.maxOutputPixels = 1000;
                return expect('GET /bulb.gif?resize=40,', 'to yield response', {
                  body: expect.it('to have metadata satisfying', {
                    size: {
                      width: 25,
                      height: 25
                    }
                  })
                });
              });
            });
          });

          describe('when omitting the height', function() {
            it('should do a proportional resize to the given width', function() {
              return expect('GET /bulb.gif?resize=,25', 'to yield response', {
                body: expect.it('to have metadata satisfying', {
                  size: {
                    width: 25,
                    height: 25
                  }
                })
              });
            });

            describe('with a maxOutputPixels setting in place', function() {
              it('should limit the size of the bounding box based on the maxOutputPixels value', function() {
                config.maxOutputPixels = 1000;
                return expect('GET /bulb.gif?resize=,40', 'to yield response', {
                  body: expect.it('to have metadata satisfying', {
                    size: {
                      width: 25,
                      height: 25
                    }
                  })
                });
              });
            });
          });
        }
      );
    });
  });

  it('should handle resize before extract', function() {
    return expect(
      'GET /cat.gif?resize=380,486&extract=150,150,100,100',
      'to yield response',
      {
        body: expect
          .it('to have metadata satisfying', {
            size: { width: 100, height: 100 },
            Scene: '3 of 4' // Animated
          })
          .and(
            'to resemble',
            pathModule.resolve(
              __dirname,
              '..',
              'testdata',
              'cat-resized-then-cropped.gif'
            )
          )
      }
    );
  });

  describe('with invalid parameters', function() {
    [
      'resize=foo,100',
      'resize=',
      'resize=100,200,300',
      'resize=0,0',
      'resize=-1,-1',
      'resize=32000,32000',
      'crop=foo',
      'crop=',
      'crop=north,south',
      'extract=',
      'extract=1,2,3,4,5',
      'extract=32000,32000,32000,32000',
      'rotate=95',
      'rotate=90,270',
      'png=hey',
      'interpolateWith=something'
    ].forEach(function(invalidOperation) {
      it('disallows an operation of ' + invalidOperation, function() {
        return expect(
          'GET /testImage.png?' + invalidOperation,
          'to yield response',
          {
            body: expect.it('to have metadata satisfying', {
              size: { width: 12, height: 5 }
            })
          }
        );
      });
    });

    it('should not break when there is only a "modifier" filter left after the invalid operations have been trimmed', function() {
      return expect(
        'GET /bulb.gif?ignoreAspectRatio&resize=NaN,NaN',
        'to yield response',
        {
          statusCode: 200,
          body: expect.it('to have metadata satisfying', {
            format: 'GIF',
            size: { width: 48, height: 48 }
          })
        }
      );
    });
  });

  describe('against a real server', function() {
    it('should destroy the created filters when the client closes the connection prematurely', function() {
      var server;
      var createdStreams = [];
      var request;
      return expect
        .promise(function(run) {
          config.filters = {
            montage: run(function() {
              return {
                create: run(function() {
                  var stream = new Stream.Transform();
                  stream._transform = function(chunk, encoding, callback) {
                    setTimeout(function() {
                      callback(null, chunk);
                    }, 1000);
                  };
                  stream.destroy = sandbox.spy().named('destroy');
                  createdStreams.push(stream);
                  setTimeout(
                    run(function() {
                      request.abort();
                    }),
                    0
                  );
                  return stream;
                })
              };
            })
          };
          server = express()
            .use(processImage(config))
            .use(express.static(root))
            .listen(0);

          var serverAddress = server.address();
          var serverHostname =
            serverAddress.address === '::'
              ? 'localhost'
              : serverAddress.address;
          var serverUrl =
            'http://' +
            serverHostname +
            ':' +
            serverAddress.port +
            '/testImage.png?montage';

          request = http.get(serverUrl);
          request.end();
          request.once(
            'error',
            run(function(err) {
              expect(err, 'to have message', 'socket hang up');
            })
          );
        })
        .then(function() {
          expect(createdStreams[0].destroy, 'was called once');
        })
        .finally(function() {
          server.close();
        });
    });
  });

  describe('with secondGuessSourceContentType=true', function() {
    beforeEach(function() {
      config.secondGuessSourceContentType = true;
    });
    it('should recover gracefully when attempting to process a wrongly named jpeg', function() {
      config.debug = true;
      return expect('GET /reallyajpeg.gif?resize=40,35', 'to yield response', {
        headers: {
          'X-Express-Processimage': 'sharp'
        },
        body: expect.it('to have metadata satisfying', {
          format: 'JPEG',
          size: { width: 40, height: 35 }
        })
      });
    });

    it('should recover gracefully when attempting to process a wrongly named png', function() {
      config.debug = true;
      return expect('GET /reallyapng.gif?resize=40,35', 'to yield response', {
        headers: {
          'X-Express-Processimage': 'sharp'
        },
        body: expect.it('to have metadata satisfying', {
          format: 'PNG',
          size: { width: 40, height: 17 }
        })
      });
    });

    it('should recover gracefully when attempting to process a wrongly named gif', function() {
      config.debug = true;
      return expect('GET /reallyagif.jpeg?resize=40,35', 'to yield response', {
        headers: {
          'X-Express-Processimage': 'gifsicle'
        },
        body: expect.it('to have metadata satisfying', {
          format: 'GIF',
          size: { width: 35, height: 35 }
        })
      });
    });

    it('should recover gracefully when attempting to process a wrongly named bmp', function() {
      config.debug = true;
      return expect(
        'GET /reallyabmp.gif?gm&resize=40,35',
        'to yield response',
        {
          headers: {
            'X-Express-Processimage': 'gm'
          },
          body: expect.it('to have metadata satisfying', {
            format: 'BMP',
            size: { width: 40, height: 25 }
          })
        }
      );
    });
  });

  it('should send an error response when an out-of-bounds extract operation is requested', function() {
    var server = express()
      .use(processImage(config))
      .use(express.static(root))
      .listen(0);

    var serverAddress = server.address();
    var serverHostname =
      serverAddress.address === '::' ? 'localhost' : serverAddress.address;
    var serverUrl = 'http://' + serverHostname + ':' + serverAddress.port + '/';

    return expect(
      serverUrl + 'turtle.jpg?extract=100,100,800,10',
      'to yield HTTP response satisfying',
      {
        body: /bad extract area/
      }
    ).finally(function() {
      server.close();
    });
  });

  it('should discard If-None-Match tokens that do not have a -processimage suffix', function() {
    return expect(
      express()
        .use(processImage(config))
        .use(function(req, res, next) {
          expect(req.headers['if-none-match'], 'to be falsy');
          res.end();
        }),
      'to yield exchange',
      {
        request: {
          url: 'GET /turtle.jpg?resize=10,10',
          headers: {
            'If-None-Match': '"foo"'
          }
        },
        response: 200
      }
    );
  });

  it('should strip the suffix from If-None-Match tokens that do have a -processimage suffix', function() {
    return expect(
      express()
        .use(processImage(config))
        .use(function(req, res, next) {
          expect(
            req.headers['if-none-match'],
            'to equal',
            '"foo" "bar-somethingelse"'
          );
          res.end();
        }),
      'to yield exchange',
      {
        request: {
          url: 'GET /turtle.jpg?resize=10,10',
          headers: {
            'If-None-Match':
              '"foo-processimage" "bar-processimage-somethingelse"'
          }
        },
        response: 200
      }
    );
  });

  describe('with a allowedImageSourceContentTypes setting', function() {
    it('should refuse to process a non-whitelisted image', function() {
      config.allowedImageSourceContentTypes = ['image/png'];
      return expect('GET /turtle.jpg?resize=100,100&png', 'to yield response', {
        headers: {
          'Content-Type': 'image/jpeg'
        },
        body: expect.it('to have metadata satisfying', {
          size: {
            width: 481,
            height: 424
          }
        })
      });
    });
  });

  it('should run resize .ico file with gm module by converting image from .ico to .png format', function() {
    return expect('GET /favicon.ico?gm&png&resize=10,10', 'to yield response', {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/png'
      },
      body: expect.it('to have metadata satisfying', {
        format: 'PNG',
        size: {
          width: 10,
          height: 10
        }
      })
    });
  });
});
