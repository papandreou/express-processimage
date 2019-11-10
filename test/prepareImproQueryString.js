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

  it('should parse jpegtran and an argument with -flip', () => {
    expect(
      'jpegtran=-grayscale,-flip,horizontal',
      'when prepared to equal',
      'jpegtran&grayscale&flip=horizontal'
    );
  });

  it('should parse pngquant with integer argument correctly', () => {
    expect(
      'resize=800,800&pngquant=8',
      'when prepared to equal',
      'resize=800,800&pngquant&speed=8'
    );
  });

  it('should parse pngcrush with integer argument correctly', () => {
    expect(
      'resize=800,800&pngcrush=-rem,gAMA',
      'when prepared to equal',
      'resize=800,800&pngcrush&rem=gAMA'
    );
  });

  it('should parse multiple engines and their operations', () => {
    expect(
      'resize=800,800&pngquant=8&pngcrush=-rem,gAMA',
      'when prepared to equal',
      'resize=800,800&pngquant&speed=8&pngcrush&rem=gAMA'
    );
  });
});
