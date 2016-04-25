/*global it, __dirname*/
var expect = require('unexpected'),
    sharp = require('sharp');

it('should process a transparent gif', function () {
    return expect.promise(function (run) {
        sharp(__dirname + '/../testdata/transparentbw.gif').flip().png().toBuffer(run(function (err, buffer) {
            expect(err, 'to be falsy');
            expect(buffer, 'when decoded as', 'binary', 'to match', /^\x89PNG/);
        }));
    });
});
