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

    describe('gm:background', function () {
        it('should match #rrggbb', function () {
            var filterInfosAndTargetContentTypeFromQueryString = getFilterInfosAndTargetContentTypeFromQueryString('background=#000000');

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

        it('should match #rgb', function () {
            var filterInfosAndTargetContentTypeFromQueryString = getFilterInfosAndTargetContentTypeFromQueryString('background=#000');

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

        it('should match #rrggbbaa', function () {
            var filterInfosAndTargetContentTypeFromQueryString = getFilterInfosAndTargetContentTypeFromQueryString('background=#00000000');

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

        it('should match #rgba', function () {
            var filterInfosAndTargetContentTypeFromQueryString = getFilterInfosAndTargetContentTypeFromQueryString('background=#0000');

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
});
