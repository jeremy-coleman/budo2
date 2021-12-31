import { ShaderDefineExpression } from '../shaderDefineExpression.js';

/** @hidden */
class ShaderDefineAndOperator extends ShaderDefineExpression {
    isTrue(preprocessors) {
        return this.leftOperand.isTrue(preprocessors) && this.rightOperand.isTrue(preprocessors);
    }
}

export { ShaderDefineAndOperator };
