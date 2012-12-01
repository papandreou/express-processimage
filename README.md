express-processimage
====================

Middleware that processes images according to the query
string. Intended to be used in a development setting with the
`connect.static` middleware, but should work with any middleware
further down the stack, even an http proxy.

**Important note: This module is intended for development. You're
strongly discouraged from using it in production or with any kind of
untrusted input. Parts of the query string will be passed directly to
various command line tools.**

The response will be be processed under these circumstances:

* If the request has a query string and accepts `image/*`.
* If the response is served with a `Content-Type` of `image/*`.

`express-processimages` plays nice with conditional GET. If the
original response has an ETag, `express-processimages` will add to it
so the ETag of the processed image never clashes with the original
ETag. That prevents the middleware issuing the original response from
being confused into sending a false positive `304 Not Modified` if
`express-processimages` is turned off or removed from the stack later.


Query string syntax
-------------------

`express-processimages` supports `pngcrush`, `pngquant`, `optipng`,
`jpegtran`, and all methods listed under "manipulation" and "drawing
primitives" in the <a
href="https://github.com/aheckmann/gm#methods">documentation for the
gm module</a>.

Multiple tools can be applied to the same image (separated by `&`, and
the order is significant). Arguments for the individual tools are
separated by non-URL encoded comma or plus.

```
http://localhost:1337/myImage.png?pngcrush=-rem,alla
http://localhost:1337/myImage.png?pngcrush=-rem+alla
http://localhost:1337/myImage.png?optipng=-o7
http://localhost:1337/bigImage.png?resize=400,300&pngquant=128&pngcrush
http://localhost:1337/hello.png?setFormat=gif
```

Installation
------------

Make sure you have node.js and npm installed, then run:

    npm install express-processimages

Example usage
-------------

Express 3.0 syntax:

```javascript
var express = require('express'),
    processImages = require('express-processimages');

express()
    .use(processImages())
    .use(express.static('/path/to/my/static/files'))
    .listen(1337);
```

License
-------

3-clause BSD license -- see the `LICENSE` file for details.
