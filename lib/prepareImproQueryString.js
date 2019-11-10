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

const resizeOptions = {
  ignoreAspectRatio: true,
  withoutEnlargement: true
};

const queryStringEngineAndArgsRegex = new RegExp(
  `^(${Object.keys(isSupportedEngine).join('|')})=(.*)`
);

module.exports = function prepareQueryString(queryString) {
  const keyValuePairs = queryString.split('&');
  const queryStringFragments = [];

  let hasResize = false;
  let optionToResize;

  for (const pair of keyValuePairs) {
    let m;

    if ((m = pair.match(queryStringEngineAndArgsRegex)) !== null) {
      const [, engineName, engineArgs] = m;
      const result = [engineName];
      const remaining = engineArgs.split(',');

      let isEngineOptions = false;
      let lastSeenOptionIndex = -1;
      let engineOptions;

      remaining.forEach((bit, index) => {
        if (engineName === 'svgfilter' && bit[0] === '-' && bit[1] === '-') {
          if (!isEngineOptions) {
            isEngineOptions = true;
            engineOptions = [];
          }
          engineOptions.push(bit.slice(2));
        } else if (bit[0] === '-') {
          result.push(bit.slice(1));
          lastSeenOptionIndex = index + 1; // account for the engine entry
        } else if (engineName === 'pngquant') {
          result.push(`speed=${bit}`);
        } else if (lastSeenOptionIndex > -1) {
          result[lastSeenOptionIndex] += `=${bit}`;
        }
      });

      if (isEngineOptions) {
        result[0] += `=${engineOptions.join('+')}`;
      }

      queryStringFragments.push(...result);
    } else {
      if (pair.startsWith('setFormat=')) {
        let format = pair.slice(10).toLowerCase();
        if (format === 'jpg') {
          format = 'jpeg';
        }
        queryStringFragments.push(format);
      } else if (pair in resizeOptions && !hasResize) {
        optionToResize = pair;
      } else {
        queryStringFragments.push(pair);
      }

      if (pair.startsWith('resize=')) {
        if (optionToResize) {
          queryStringFragments.push(optionToResize);
          optionToResize = undefined;
        } else {
          hasResize = true;
        }
      }
    }
  }

  return queryStringFragments.join('&');
};
