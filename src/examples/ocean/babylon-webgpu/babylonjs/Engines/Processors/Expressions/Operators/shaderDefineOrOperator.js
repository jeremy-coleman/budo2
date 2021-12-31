import { ShaderDefineExpression } from '../shaderDefineExpression.js';

/** @hidden */
class ShaderDefineOrOperator extends ShaderDefineExpression {
    isTrue(preprocessors) {
        return this.leftOperand.isTrue(preprocessors) || this.rightOperand.isTrue(preprocessors);
    }
}

export { ShaderDefineOrOperator };
