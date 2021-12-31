/**
 * Class containing a set of static utilities functions for arrays.
 */
class ArrayTools {
    /**
     * Returns an array of the given size filled with elements built from the given constructor and the parameters.
     * @param size the number of element to construct and put in the array.
     * @param itemBuilder a callback responsible for creating new instance of item. Called once per array entry.
     * @returns a new array filled with new objects.
     */
    static BuildArray(size, itemBuilder) {
        const a = [];
        for (let i = 0; i < size; ++i) {
            a.push(itemBuilder());
        }
        return a;
    }
    /**
     * Returns a tuple of the given size filled with elements built from the given constructor and the parameters.
     * @param size he number of element to construct and put in the tuple.
     * @param itemBuilder a callback responsible for creating new instance of item. Called once per tuple entry.
     * @returns a new tuple filled with new objects.
     */
    static BuildTuple(size, itemBuilder) {
        return ArrayTools.BuildArray(size, itemBuilder);
    }
}

export { ArrayTools };
