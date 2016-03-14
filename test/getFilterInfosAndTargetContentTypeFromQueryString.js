/*global describe, it*/
var getFilterInfosAndTargetContentTypeFromQueryString = require('../lib/getFilterInfosAndTargetContentTypeFromQueryString');

var expect = require('unexpected');

describe('getFilterInfosAndTargetContentTypeFromQueryString', function () {
    it('should make the right engine choice even if the source Content-Type is not available until filterInfo.create is called', function () {
        var sourceMetadata = {};
        var filterInfosAndTargetContentTypeFromQueryString = getFilterInfosAndTargetContentTypeFromQueryString('resize=10,10', {
            sourceMetadata: sourceMetadata
        });

        sourceMetadata.contentType = 'image/gif';

        filterInfosAndTargetContentTypeFromQueryString.filterInfos[0].create();

        expect(filterInfosAndTargetContentTypeFromQueryString, 'to satisfy', {
            operationNames: [ 'gifsicle' ],
            filterInfos: {
                0: {
                    targetContentType: 'image/gif',
                    operationName: 'gifsicle'
                }
            }
        });
    });
});
