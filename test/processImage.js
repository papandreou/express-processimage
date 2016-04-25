/*global describe, it, beforeEach, __dirname*/
var express = require('express'),
    fs = require('fs'),
    http = require('http'),
    pathModule = require('path'),
    unexpected = require('unexpected'),
    processImage = require('../lib/processImage'),
    root = pathModule.resolve(__dirname, '..', 'testdata') + '/',
    sharp = require('sharp-paras20xx');

describe('express-processimage', function () {
    var config;
    beforeEach(function () {
        config = { root: root, filters: {} };
    });

    var expect = unexpected.clone()
        .use(require('unexpected-express'))
        .use(require('magicpen-prism'))
        .addAssertion('<string|object> to yield response <object|number>', function (expect, subject, value) {
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

    it('should process and convert a transparent gif', function () {
        return expect('GET /transparentbw.gif?flip&png', 'to yield response', {
            body: expect.it('when decoded as', 'binary', 'to match', /^\x89PNG/)
        });
    });
});
