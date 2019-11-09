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
});
