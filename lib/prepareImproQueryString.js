const isSupportedEngine = {
  gm: true,
  sharp: true,
  pngcrush: true,
  pngquant: true,
  jpegtran: true,
  optipng: true,
  svgfilter: true,
  inkscape: true
};

const queryStringEngineAndArgsRegex = new RegExp(
  `^(${Object.keys(isSupportedEngine).join('|')})=(.*)`
);

module.exports = function prepareQueryString(queryString) {
  const keyValuePairs = queryString.split('&');
  const queryStringFragments = [];

  for (const pair of keyValuePairs) {
    let m;

    if ((m = pair.match(queryStringEngineAndArgsRegex)) !== null) {
      const [, engineName, engineArgs] = m;
      const result = [engineName];
      const remaining = engineArgs.split(',');

      let isEngineOptions = false;
      let engineOptions;

      remaining.forEach(bit => {
        if (engineName === 'svgfilter' && bit[0] === '-' && bit[1] === '-') {
          if (!isEngineOptions) {
            isEngineOptions = true;
            engineOptions = [];
          }
          engineOptions.push(bit.slice(2));
        } else if (bit[0] === '-') {
          result.push(bit.slice(1));
        } else if (bit === 'horizontal' || bit === 'vertical') {
          const indexOfArg = result.indexOf('flip');
          if (indexOfArg > -1) {
            result[indexOfArg] += `=${bit}`;
          } else {
            // XXX
          }
        } else if (engineName === 'pngquant') {
          result.push(`speed=${bit}`);
        }
      });

      if (isEngineOptions) {
        result[0] += `=${engineOptions.join('+')}`;
      }

      queryStringFragments.push(...result);
    } else {
      queryStringFragments.push(pair);
    }
  }

  return queryStringFragments.join('&');
};
