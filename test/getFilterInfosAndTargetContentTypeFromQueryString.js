/*global describe, it*/
const getFilterInfosAndTargetContentTypeFromQueryString = require('../lib/getFilterInfosAndTargetContentTypeFromQueryString');

const expect = require('unexpected');

describe('getFilterInfosAndTargetContentTypeFromQueryString', () => {
  it('should make the right engine choice even if the source Content-Type is not available until filterInfo.create is called', () => {
    const filterInfosAndTargetContentTypeFromQueryString = getFilterInfosAndTargetContentTypeFromQueryString(
      'resize=10,10',
      {
        sourceMetadata: {
          contentType: 'image/gif'
        }
      }
    );

    filterInfosAndTargetContentTypeFromQueryString.filterInfos[0].create();

    expect(filterInfosAndTargetContentTypeFromQueryString, 'to satisfy', {
      operationNames: ['gifsicle'],
      filterInfos: [
        {
          targetContentType: 'image/gif',
          operationName: 'gifsicle'
        }
      ]
    });
  });

  describe('gm:background', () => {
    it('should match #rrggbb', () => {
      const filterInfosAndTargetContentTypeFromQueryString = getFilterInfosAndTargetContentTypeFromQueryString(
        'background=#000000'
      );

      filterInfosAndTargetContentTypeFromQueryString.filterInfos[0].create();

      expect(filterInfosAndTargetContentTypeFromQueryString, 'to satisfy', {
        filterInfos: [
          {
            operations: [
              {
                name: 'background',
                usedQueryStringFragment: 'background=#000000'
              }
            ],
            leftOverQueryStringFragments: undefined
          }
        ]
      });
    });

    it('should match #rgb', () => {
      const filterInfosAndTargetContentTypeFromQueryString = getFilterInfosAndTargetContentTypeFromQueryString(
        'background=#000'
      );

      filterInfosAndTargetContentTypeFromQueryString.filterInfos[0].create();

      expect(filterInfosAndTargetContentTypeFromQueryString, 'to satisfy', {
        filterInfos: [
          {
            operations: [
              {
                name: 'background',
                usedQueryStringFragment: 'background=#000'
              }
            ],
            leftOverQueryStringFragments: undefined
          }
        ]
      });
    });

    it('should match #rrggbbaa', () => {
      const filterInfosAndTargetContentTypeFromQueryString = getFilterInfosAndTargetContentTypeFromQueryString(
        'background=#00000000'
      );

      filterInfosAndTargetContentTypeFromQueryString.filterInfos[0].create();

      expect(filterInfosAndTargetContentTypeFromQueryString, 'to satisfy', {
        filterInfos: [
          {
            operations: [
              {
                name: 'background',
                usedQueryStringFragment: 'background=#00000000'
              }
            ],
            leftOverQueryStringFragments: undefined
          }
        ]
      });
    });

    it('should match #rgba', () => {
      const filterInfosAndTargetContentTypeFromQueryString = getFilterInfosAndTargetContentTypeFromQueryString(
        'background=#0000'
      );

      filterInfosAndTargetContentTypeFromQueryString.filterInfos[0].create();

      expect(filterInfosAndTargetContentTypeFromQueryString, 'to satisfy', {
        filterInfos: [
          {
            operations: [
              {
                name: 'background',
                usedQueryStringFragment: 'background=#0000'
              }
            ],
            leftOverQueryStringFragments: undefined
          }
        ]
      });
    });
  });

  describe('sharp', () => {
    it('should allow using setFormat to specify the output format', () => {
      const filterInfosAndTargetContentTypeFromQueryString = getFilterInfosAndTargetContentTypeFromQueryString(
        'setFormat=png',
        {
          defaultEngineName: 'sharp',
          sourceMetadata: {
            contentType: 'image/jpeg'
          }
        }
      );

      filterInfosAndTargetContentTypeFromQueryString.filterInfos[0].create();

      expect(filterInfosAndTargetContentTypeFromQueryString, 'to satisfy', {
        targetContentType: 'image/png',
        operationNames: ['sharp'],
        filterInfos: [
          {
            operationName: 'sharp'
          }
        ]
      });
    });

    describe('with a conversion to image/gif', () => {
      it('should fall back to another engine', () => {
        const filterInfosAndTargetContentTypeFromQueryString = getFilterInfosAndTargetContentTypeFromQueryString(
          'setFormat=gif',
          {
            defaultEngineName: 'sharp',
            sourceMetadata: {
              contentType: 'image/jpeg'
            }
          }
        );

        filterInfosAndTargetContentTypeFromQueryString.filterInfos[0].create();

        expect(filterInfosAndTargetContentTypeFromQueryString, 'to satisfy', {
          targetContentType: 'image/gif',
          operationNames: ['gm'],
          filterInfos: [
            {
              operationName: 'gm'
            }
          ]
        });
      });

      it('should fall back to gm if there is an unsupported operation', () => {
        const filterInfosAndTargetContentTypeFromQueryString = getFilterInfosAndTargetContentTypeFromQueryString(
          'setFormat=gif&embed',
          {
            defaultEngineName: 'sharp',
            sourceMetadata: {
              contentType: 'image/jpeg'
            }
          }
        );

        filterInfosAndTargetContentTypeFromQueryString.filterInfos[0].create();

        expect(filterInfosAndTargetContentTypeFromQueryString, 'to satisfy', {
          targetContentType: 'image/gif',
          operationNames: ['gm', 'sharpOrGm'],
          filterInfos: [
            {
              operationName: 'gm'
            },
            {
              operationName: 'sharpOrGm'
            }
          ]
        });
      });
    });
  });
});
