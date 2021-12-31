import { ShaderDefineExpression } from '../shaderDefineExpression.js';

/** @hidden */
class ShaderDefineArithmeticOperator extends ShaderDefineExpression {
    constructor(define, operand, testValue) {
        super();
        this.define = define;
        this.operand = operand;
        this.testValue = testValue;
    }
    isTrue(preprocessors) {
        let value = preprocessors[this.define];
        if (value === undefined) {
            value = this.define;
        }
        let condition = false;
        let left = parseInt(value);
        let right = parseInt(this.testValue);
        switch (this.operand) {
            case ">":
                condition = left > right;
                break;
            case "<":
                condition = left < right;
                break;
            case "<=":
                condition = left <= right;
                break;
            case ">=":
                condition = left >= right;
                break;
            case "==":
                condition = left === right;
                break;
        }
        return condition;
    }
}

export { ShaderDefineArithmeticOperator };
