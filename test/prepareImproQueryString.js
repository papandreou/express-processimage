const expect = require('unexpected').clone();

const prepareImproQueryString = require('../lib/prepareImproQueryString');

expect.addAssertion('<string> when prepared <assertion>', (expect, subject) => {
  expect.errorMode = 'nested';

  return expect.shift(prepareImproQueryString(subject));
});

describe('prepareImproQueryString', () => {
  it('should parse resize (comma separator)', () => {
    expect('resize=800,800', 'when prepared to equal', 'resize=800,800');
  });

  it('should parse resize (plus separator)', () => {
    expect('resize=800+800', 'when prepared to equal', 'resize=800,800');
  });

  it('should parse svgfilter with options', () => {
    expect(
      'svgfilter=--runScript=addBogusElement.js,--bogusElementId=theBogusElementId',
      'when prepared to equal',
      'svgfilter=runScript=addBogusElement.js+bogusElementId=theBogusElementId'
    );
  });

  it('should parse setFormat and other arguments', () => {
    expect(
      'setFormat=JPG&resize=800,800',
      'when prepared to equal',
      'jpeg&resize=800,800'
    );
  });

  it('should parse ignoreAspectRatio followed by resize', () => {
    expect(
      'ignoreAspectRatio&resize=800,800',
      'when prepared to equal',
      'resize=800,800&ignoreAspectRatio'
    );
  });

  it('should parse withoutEnlargement followed by resize', () => {
    expect(
      'withoutEnlargement&resize=800,800',
      'when prepared to equal',
      'resize=800,800&withoutEnlargement'
    );
  });

  it('should parse resize followed by withoutEnlargement', () => {
    expect(
      'resize=800,800&withoutEnlargement',
      'when prepared to equal',
      'resize=800,800&withoutEnlargement'
    );
  });

  it('should parse jpegtran and an argument with -flip', () => {
    expect(
      'jpegtran=-grayscale,-flip,horizontal',
      'when prepared to equal',
      'jpegtran&grayscale&flip=horizontal'
    );
  });

  it('should parse optipng with no argument', () => {
    expect('optipng', 'when prepared to equal', 'optipng');
  });

  it('should parse pngquant with integer argument correctly', () => {
    expect(
      'resize=800,800&pngquant=8',
      'when prepared to equal',
      'resize=800,800&pngquant&speed=8'
    );
  });

  it('should parse pngcrush with -rm argument correctly (using -)', () => {
    expect(
      'resize=800,800&pngcrush=-rem,gAMA',
      'when prepared to equal',
      'resize=800,800&pngcrush&rem=gAMA'
    );
  });

  it('should parse pngcrush with -rm argument correctly (using +)', () => {
    expect(
      'resize=800,800&pngcrush=-rem+pHYs',
      'when prepared to equal',
      'resize=800,800&pngcrush&rem=pHYs'
    );
  });

  it('should parse multiple engines and their operations', () => {
    expect(
      'resize=800,800&pngquant=8&pngcrush=-rem,gAMA',
      'when prepared to equal',
      'resize=800,800&pngquant&speed=8&pngcrush&rem=gAMA'
    );
  });

  it('should parse the single format form of resize', () => {
    expect('resize=800', 'when prepared to equal', 'resize=800,');
  });
});
