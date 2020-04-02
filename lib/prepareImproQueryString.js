const isSupportedEngine = {
  gm: true,
  sharp: true,
  pngcrush: true,
  pngquant: true,
  jpegtran: true,
  optipng: true,
  svgfilter: true,
  inkscape: true,
};

const resizeOptions = {
  ignoreAspectRatio: true,
  withoutEnlargement: true,
};

const queryStringEngineAndArgsRegex = new RegExp(
  `^(${Object.keys(isSupportedEngine).join('|')})(?:=(.*))?`
);

module.exports = function prepareQueryString(queryString) {
  const keyValuePairs = queryString.split('&');
  const queryStringFragments = [];

  let hasResize = false;
  let optionToResize;

  for (const pair of keyValuePairs) {
    let m;

    if ((m = pair.match(queryStringEngineAndArgsRegex)) !== null) {
      const [, engineName, engineArgs = ''] = m;
      const result = [engineName];
      const splitChar = engineArgs.includes('+') ? '+' : ',';
      const remaining = engineArgs.split(splitChar);

      let isEngineOptions = false;
      let lastSeenOptionIndex = -1;
      let engineOptions;

      for (const [index, bit] of remaining.entries()) {
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
      }

      if (isEngineOptions) {
        result[0] += `=${engineOptions.join('+')}`;
      }

      queryStringFragments.push(...result);
    } else {
      const keyAndValue = pair.split('=');
      if (keyAndValue.length === 1) keyAndValue.unshift('');
      const [op, arg] = keyAndValue;

      if (op === 'setFormat') {
        let format = arg.toLowerCase();
        if (format === 'jpg') {
          format = 'jpeg';
        }
        queryStringFragments.push(format);
      } else if (arg in resizeOptions && !hasResize) {
        optionToResize = arg;
      } else {
        let fragment = pair;
        if (op === 'resize') {
          if (arg.indexOf('+') > -1) {
            // specified using a plus operator
            fragment = fragment.replace('+', ',');
          } else if (arg.indexOf(',') === -1) {
            // single value form of resize
            fragment += ',';
          }
        }
        queryStringFragments.push(fragment);
      }

      if (op === 'resize') {
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
