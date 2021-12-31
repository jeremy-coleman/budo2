import { ShaderDefineExpression } from '../shaderDefineExpression.js';

/** @hidden */
class ShaderDefineIsDefinedOperator extends ShaderDefineExpression {
    constructor(define, not = false) {
        super();
        this.define = define;
        this.not = not;
    }
    isTrue(preprocessors) {
        let condition = preprocessors[this.define] !== undefined;
        if (this.not) {
            condition = !condition;
        }
        return condition;
    }
}

export { ShaderDefineIsDefinedOperator };
