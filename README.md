# express-processimage

[![NPM version](https://badge.fury.io/js/express-processimage.svg)](http://badge.fury.io/js/express-processimage)
[![Build Status](https://travis-ci.org/papandreou/express-processimage.svg?branch=master)](https://travis-ci.org/papandreou/express-processimage)
[![Coverage Status](https://coveralls.io/repos/papandreou/express-processimage/badge.svg)](https://coveralls.io/r/papandreou/express-processimage)
[![Dependency Status](https://david-dm.org/papandreou/express-processimage.svg)](https://david-dm.org/papandreou/express-processimage)

Middleware that processes images according to the query string.
It is intended to be used in a development setting with the static
middleware, but should play well with any middleware further down
the stack, even an http proxy, via
[hijackresponse](https://github.com/gustavnikolaj/hijackresponse).

Images are processed using the [impro](https://github.com/papandreou/impro)
module which implements automatic switching between a number of image
libraries based on the requested options.

> **Important note: This module is intended for development. While impro
> validates requested image operations, ultimately image data which could
> be untrusted in such use would be passed directly to various command line
> tools. In addition, extremely large images represent an attack surface
> unless restrictions on maximum input and output sizes are configured.**

## Installation

Make sure you have node.js and npm installed, then run:

    npm install express-processimage

## Query string syntax

`express-processimage` supports `pngcrush`, `pngquant`, `optipng`,
`jpegtran`, <a
href="https://github.com/papandreou/node-inkscape">`inkscape`</a>, <a
href="https://github.com/papandreou/node-svgfilter">`svgfilter`</a>,
and all methods listed under "manipulation" and "drawing primitives"
in the <a href="https://github.com/aheckmann/gm#methods">documentation
for the gm module</a>.

Multiple tools can be applied to the same image (separated by `&`, and
the order is significant). Arguments for the individual tools are
separated by non-URL encoded comma or plus.

```
http://localhost:1337/myImage.png?pngcrush=-rem,alla
http://localhost:1337/myImage.png?pngcrush=-rem+alla
http://localhost:1337/myImage.png?optipng=-o7
http://localhost:1337/bigImage.png?resize=400,300&pngquant=128&pngcrush
http://localhost:1337/hello.png?setFormat=gif
http://localhost:1337/logo.svg?inkscape
http://localhost:1337/file.svg?svgfilter=--runScript=makeItBlue.js
```

## Example usage

Express 3.0 syntax:

```javascript
var express = require('express'),
  processImage = require('express-processimage'),
  root = '/path/to/my/static/files';

express()
  .use(processImage({ root: root }))
  .use(express.static(root))
  .listen(1337);
```

From this point forward, the resposnes tp GET requests to port 1337 are
matched by their Content-Type matched and in the case of an it will be
processed by the image pipeline using options specified in query string.
The processed output is delivered to the client.

### Svg processing

The `root` option is used by <a
href="https://github.com/papandreou/node-svgfilter">node-svgfilter</a>
for finding the location of external JavaScript files to run on the SVG document.

## Response processing

The response will be be processed under these circumstances:

- If the request has a query string and accepts `image/*`.
- If the response is served with a `Content-Type` of `image/*`.

`express-processimage` plays nice with conditional GET. If the
original response has an ETag, `express-processimage` will add to it
so the ETag of the processed image never clashes with the original
ETag. That prevents the middleware issuing the original response from
being confused into sending a false positive `304 Not Modified` if
`express-processimage` is turned off or removed from the stack later.

## Development with Docker

Build the docker image by running:

```
$ npm run docker:build
```

Open the development environment:

```
$ npm run docker
```

The above command will place you in a bash shell where the working directory is
your express-processimage checkout from your local machine. It is mounted into
the container which is based on Ubuntu 14.04 and contains all the required
dependencies, and nvm with the latest node 8 version active.

If you need to run the tests against another node version, you just have to
change the version using nvm and reinstall your modules.

The environment is configured to resemble our setup on Travis CI as much as
possible.

## License

3-clause BSD license -- see the `LICENSE` file for details.
