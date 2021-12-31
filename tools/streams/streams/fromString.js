import { Readable } from 'stream';
// create a stream from a string
// str -> stream
function fromString(string) {
    var rs = new Readable({ objectMode: true });
    if (string.length <= 0) {
        rs.push(null);
        return rs;
    }
    rs.push(string);
    rs.push(null);
    return rs;
}
export { fromString };
