/**
 * @class SnowflakeRangeQuery
 * @description Preprocessing and range query with binary search
 * @since 1.0.0
 */
class SnowflakeRangeQuery {
    #array = [];

    /**
     * @param {Array<Object>} array - The array of objects to operate on.
     * Each object should contain a numerical field that can be used for sorting and searching.
     * @since 1.0.0
     */
    constructor(array) {
        this.#array = array;
    }

    /**
     * Performs a binary search to find the smallest element in the array
     * with the specified field value greater than or equal to a target.
     * @param {Array<Object>} array - The sorted array to search within.
     * @param {number} target - The target value to compare against.
     * @returns {Object|null} - The object with the smallest field value >= target, or null if none found.
     * @since 1.0.0
     */
    binarySearch(array, target) {
        let left = 0,
            right = array.length - 1,
            result = null;

        while(left <= right) {

            const mid = Math.floor((left + right) / 2);

            if(array[mid].size >= target) {

                // Found a candidate, continue searching for smaller fits
                result = array[mid];

                // Move left to find the smallest possible size >= target
                right = mid - 1;

            }
            else {

                // Move right if the size is too small
                left = mid + 1;

            }

        }

        return result;
    }

    /**
     * Sorts the array by a specified field name.
     * @param {string} field_name - The field name to sort by.
     * @returns {SnowflakeRangeQuery} - The current instance for chaining.
     */
    sortBy(field_name) {

        // Sort the array by a specific field
        this.#array.sort((a, b) => (a[field_name] ?? 0) - (b[field_name] ?? 0));

        return this;

    }

    /**
     * Finds the smallest object that meets the fit condition for the specified field.
     * This method first checks the largest value in the array to determine if any element can meet the condition.
     * Then it uses binary search to find the smallest fit.
     *
     * @example
     * const query = new SnowflakeRangeQuery(data);
     * query.sortBy('size');
     * const result = query.findSmallestFit('size', 10);
     * console.log(result);
     *
     * @param {string} field_name - The field name to evaluate for the fit condition.
     * @param {number} fit - The minimum required value for the field.
     * @returns {Object|null} - The smallest object with field value >= fit, or null if no such object exists.
     *
     * @since 1.0.0
     */
    findSmallestFit(field_name, fit) {
        const largestSizeElement = this.#array[this.#array.length - 1];
        const largestSize = largestSizeElement[field_name] ?? null;

        if(largestSize === null) return null;

        if(largestSize >= fit) {
            const smallestFit = this.binarySearch(this.#array, fit);
            if(smallestFit) return smallestFit;
        }
        return null;
    }

    /**
     * Gets the current array.
     * @returns {Array<Object>} - The array managed by the query instance.
     * @since 1.0.0
     */
    get array() {
        return this.#array;
    }
}


module.exports = SnowflakeRangeQuery;