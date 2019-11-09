const expect = require('unexpected').clone();

const prepareImproQueryString = require('../lib/prepareImproQueryString');

expect.addAssertion('<string> when prepared <assertion>', (expect, subject) => {
  expect.errorMode = 'nested';

  return expect.shift(prepareImproQueryString(subject));
});

describe('prepareImproQueryString', () => {
  it('should parse svgfilter with options', () => {
    expect(
      'svgfilter=--runScript=addBogusElement.js,--bogusElementId=theBogusElementId',
      'when prepared to equal',
      'svgfilter=runScript=addBogusElement.js+bogusElementId=theBogusElementId'
    );
  });

  it('should parse pngquant with integer argument correctly', () => {
    expect(
      'resize=800,800&pngquant=8',
      'when prepared to equal',
      'resize=800,800&pngquant&speed=8'
    );
  });
});
