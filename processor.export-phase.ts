import * as fs from "fs"
import * as path from "path"
import * as ts from "typescript"
import * as TypeMap from './type-map'
import * as GatherPhase from './processor.gather-phase'
import { mkdirRec } from './tools';
import { preJavaTypeVisit } from './prejavatypes/PreJavaTypeVisit'
import { TextFlow, JavaWriter } from './TextFlow'

import { PreJavaType } from './prejavatypes/PreJavaType'
import { PreJavaTypeClassOrInterface } from './prejavatypes/PreJavaTypeClassOrInterface'
import { PreJavaTypeBuiltinJavaType } from './prejavatypes/PreJavaTypeBuiltinJavaType'
import { PreJavaTypeEnum } from './prejavatypes/PreJavaTypeEnum'
import { PreJavaTypeUnion } from './prejavatypes/PreJavaTypeUnion'
import { PreJavaTypeParameter } from './prejavatypes/PreJavaTypeParameter'
import { PreJavaTypeTuple, TUPLE_TYPE_VARIABLE_NAMES } from './prejavatypes/PreJavaTypeTuple'
import { PreJavaTypeReference } from './prejavatypes/PreJavaTypeReference'


export class ExportPhase {
    constructor(public gatherPhase: GatherPhase.GatherPhase) { }

    exportJavaUnit(type: PreJavaType, javaWriter: JavaWriter, flow: TextFlow, baseDirectory: string) {
        let content = ''
        content += `package ${type.getPackageName()};\n`
        content += '\n'
        for (let importedType of javaWriter.imports.keys())
            content += `import ${importedType.getFullyQualifiedName(null)};\n`
        content += '\n'
        content += flow.content()

        let fileDirectory = path.join(baseDirectory, type.getPackageName().replace(new RegExp('\\.', 'g'), '/'))
        mkdirRec(fileDirectory)

        let fileName = path.join(fileDirectory, `${type.getSimpleName(null)}.java`)
        fs.writeFileSync(fileName, content, 'utf8')
    }

    private reservedWords: { [key: string]: string } = {
        '_': '_underscore_',
        'public': '_public_',
        'protected': 'protected_',
        'private': 'private_',
        'do': 'do_',
        'switch': 'switch_',
        'char': 'char_',
        'class': 'class_',
        'extends': 'extends_',
        'return': 'return_',
        'throw': 'throw_',
        'catch': 'catch_',
        'finally': 'finally_',
        'import': 'import_',
        'assert': 'assert_',
        'default': 'default_',
        'continue': 'continue_',

        'className': 'clasName'
    }

    escapePropertyName(symbolName: string) {
        if (symbolName.indexOf('@') >= 0)
            symbolName = symbolName.replace(new RegExp('@', 'g'), '_at_')
        if (symbolName.indexOf('-') >= 0)
            symbolName = symbolName.replace(new RegExp('-', 'g'), '_dash_')
        if (symbolName.indexOf('[') >= 0)
            symbolName = symbolName.replace(new RegExp('\\[', 'g'), '_open_bracket_')
        if (symbolName.indexOf(']') >= 0)
            symbolName = symbolName.replace(new RegExp('\\]', 'g'), '_close_bracket_')
        if (symbolName.indexOf('.') >= 0)
            symbolName = symbolName.replace(new RegExp('\\.', 'g'), '_dot_')
        if (symbolName in this.reservedWords && typeof this.reservedWords[symbolName] === 'string')
            return this.reservedWords[symbolName]
        return symbolName
    }

    escapeMethodName(symbolName: string) {
        return this.escapePropertyName(symbolName)
    }

    JS_TYPE = new PreJavaTypeBuiltinJavaType('jsinterop.annotations', 'JsType')
    JS_OVERLAY = new PreJavaTypeBuiltinJavaType('jsinterop.annotations', 'JsOverlay')
    JS_PROPERTY = new PreJavaTypeBuiltinJavaType('jsinterop.annotations', 'JsProperty')
    JS_PACKAGE = new PreJavaTypeBuiltinJavaType('jsinterop.annotations', 'JsPackage')
    JS_METHOD = new PreJavaTypeBuiltinJavaType('jsinterop.annotations', 'JsMethod')
    JS_ARRAY_LIKE = new PreJavaTypeBuiltinJavaType('jsinterop.base', 'JsArrayLike')
    JS = new PreJavaTypeBuiltinJavaType('jsinterop.base', 'Js')

    exportNodes(program: ts.Program, baseDirectory: string) {
        for (let type of this.gatherPhase.typeMap.typeMap.values()) {
            console.log(`export ${type.getParametrizedFullyQualifiedName(null)}`)
            preJavaTypeVisit(type, {
                onVisitUnion: (type) => {
                    let javaWriter = new JavaWriter(type.getPackageName())
                    let flow = new TextFlow()

                    javaWriter.importType(this.JS_TYPE)
                    javaWriter.importType(this.JS)

                    flow.startJavaDocComments()
                    flow.push(`Union adapter`).finishLine()
                    flow.endJavaDocComments()
                    javaWriter.importType(this.JS_PACKAGE)
                    flow.push(`@JsType(isNative=true, namespace=JsPackage.GLOBAL, name="?")`).finishLine()
                    flow.push(`public class ${type.getParametrizedSimpleName(null)} {`).finishLine()
                    flow.pushLineStart('    ')
                    for (let unionedType of type.types) {
                        javaWriter.importType(this.JS_OVERLAY)

                        flow.push(`@JsOverlay`).finishLine()
                        flow.push(`public ${javaWriter.importTypeParametrized(unionedType)} as${unionedType.getHumanizedName(null)}() {`).finishLine()
                        flow.pushLineStart('    ')
                        flow.push(`return Js.uncheckedCast( this );`).finishLine()
                        flow.pullLineStart()
                        flow.push(`}`).finishLine()

                        flow.push(`public static ${type.getParametrization(null)} ${type.getParametrizedSimpleName(null)} of${unionedType.getHumanizedName(null)}(${unionedType.getSimpleName(null)} value) {`).finishLine()
                        flow.pushLineStart('    ')
                        flow.push(`return Js.uncheckedCast( value );`).finishLine()
                        flow.pullLineStart()
                        flow.push(`}`).finishLine()
                    }
                    flow.pullLineStart()
                    flow.push(`}`).finishLine()

                    this.exportJavaUnit(type, javaWriter, flow, baseDirectory)
                },
                onVisitTuple: (type) => {
                    let javaWriter = new JavaWriter(type.getPackageName())
                    let flow = new TextFlow()

                    javaWriter.importType(this.JS_TYPE)

                    flow.startJavaDocComments()
                    flow.push(`Tuple adapter`).finishLine()
                    flow.endJavaDocComments()

                    javaWriter.importType(this.JS_PACKAGE)
                    flow.push(`@JsType(isNative=true, namespace=JsPackage.GLOBAL, name="?")`).finishLine()
                    flow.push(`public class ${type.getParametrizedSimpleName(null)} {`).finishLine()
                    flow.pushLineStart('    ')
                    javaWriter.importType(this.JS_OVERLAY)
                    javaWriter.importType(this.JS)
                    for (let i = 0; i < type.typeParameters.length; i++) {
                        let variableName = TUPLE_TYPE_VARIABLE_NAMES[i]

                        flow.push(`@JsOverlay`).finishLine()
                        flow.push(`public ${variableName} getNb${i + 1}() {`).finishLine()
                        flow.pushLineStart('    ')
                        flow.push(`return (${variableName}) Js.asArrayLike(this).getAt(${i});`).finishLine()
                        flow.pullLineStart()
                        flow.push(`}`).finishLine()

                        flow.push(`@JsOverlay`).finishLine()
                        flow.push(`public void setNb${i + 1}(${variableName} value) {`).finishLine()
                        flow.pushLineStart('    ')
                        flow.push(`Js.asArrayLike(this).setAt(${i}, value);`).finishLine()
                        flow.pullLineStart()
                        flow.push(`}`).finishLine()
                    }

                    flow.push(`@JsOverlay`).finishLine()
                    flow.push(`public ${javaWriter.importType(this.JS_ARRAY_LIKE)}<Object> asList() {`).finishLine()
                    flow.pushLineStart('    ')
                    flow.push(`return Js.uncheckedCast(this);`).finishLine()
                    flow.pullLineStart()
                    flow.push(`}`).finishLine()

                    flow.pullLineStart()
                    flow.push(`}`).finishLine()

                    this.exportJavaUnit(type, javaWriter, flow, baseDirectory)
                },
                onVisitEnumType: (type) => {
                    let javaWriter = new JavaWriter(type.getPackageName())
                    let flow = new TextFlow()

                    javaWriter.importType(this.JS)

                    flow.startJavaDocComments()
                    flow.push(`Enumeration adapter`).finishLine()
                    flow.endJavaDocComments()
                    flow.push(`public abstract class ${type.getParametrizedSimpleName(null)} extends Number {`).finishLine()
                    flow.pushLineStart('    ')
                    for (let member of type.members)
                        flow.push(`public static ${type.getParametrizedSimpleName(null)} ${member.name} = Js.uncheckedCast( ${member.value} );`).finishLine()
                    flow.pullLineStart()
                    flow.push(`}`).finishLine()

                    this.exportJavaUnit(type, javaWriter, flow, baseDirectory)
                },
                onVisitClassOrInterfaceType: (type) => {
                    let javaWriter = new JavaWriter(type.getPackageName())
                    let flow = new TextFlow()

                    flow.startJavaDocComments()
                    if (type.sourceTypes && type.sourceTypes.size) {
                        type.sourceTypes.forEach(sourceType => {
                            flow.push(`base type: ${sourceType.getSymbol() ? program.getTypeChecker().getFullyQualifiedName(sourceType.getSymbol()) : 'no symbol'}`).finishLine()
                            flow.push(`flags: ${sourceType.flags}`).finishLine()
                            if (sourceType && sourceType.symbol && sourceType.symbol && sourceType.symbol.declarations && sourceType.symbol.declarations.length)
                                sourceType.symbol.declarations.forEach(declaration => flow.push(`declared in: ${declaration.getSourceFile().fileName}:${declaration.pos}`).finishLine())
                        })
                    }
                    if (type.constructorSignatures && type.constructorSignatures.length) {
                        flow.push(`${type.constructorSignatures.length} constructors`)
                    }
                    if (type.comments && type.comments.length) {
                        flow.blankLine()
                        flow.push(type.comments)
                    }
                    flow.endJavaDocComments()

                    let isClass = type.isClassLike()

                    let prototypeName = null
                    let prototypeNamespace = null
                    if (type.prototypeNames) {
                        for (let name of type.prototypeNames.values()) {
                            let index = name.lastIndexOf('.')
                            if (index >= 0) {
                                prototypeNamespace = name.substring(0, index)
                                prototypeName = name.substring(index + 1)
                            }
                            else {
                                prototypeName = name
                            }
                            break
                        }
                    }
                    javaWriter.importType(this.JS_TYPE)
                    if (!prototypeNamespace)
                        javaWriter.importType(this.JS_PACKAGE)
                    flow.push(`@JsType(isNative=true, namespace=${prototypeNamespace ? ('"' + prototypeNamespace + '"') : 'JsPackage.GLOBAL'}, name=${prototypeName ? ('"' + prototypeName + '"') : '"Object"'})`)
                    flow.finishLine()
                    flow.push(`public ${isClass ? 'class' : 'interface'} ${type.getSimpleName()}`)
                    if (type.typeParameters && type.typeParameters.length)
                        flow.push(`<${type.typeParameters.map(tp => javaWriter.importType(tp)).join(', ')}>`)
                    if (type.baseTypes) {
                        let extendsTypes: PreJavaType[] = []
                        let implementsTypes: PreJavaType[] = []

                        for (let baseType of type.baseTypes.values()) {
                            if (baseType == TypeMap.BUILTIN_TYPE_OBJECT)
                                continue

                            if (!isClass || baseType.isClassLike())
                                extendsTypes.push(baseType)
                            else
                                implementsTypes.push(baseType)
                        }

                        if (extendsTypes.length)
                            flow.push(` extends ${extendsTypes.map(t => javaWriter.importTypeParametrized(t)).join(', ')}`)

                        if (implementsTypes.length)
                            flow.push(` implements ${implementsTypes.map(t => javaWriter.importTypeParametrized(t)).join(', ')}`)
                    }
                    flow.finishLine()

                    flow.push(`{`)
                    flow.finishLine()

                    flow.pushLineStart('    ')

                    if (isClass && type.constructorSignatures && type.constructorSignatures.length) {
                        flow.blankLine()
                            .push('/*\n    Constructors\n*/').finishLine()

                        type.constructorSignatures.forEach(constructr => {
                            if (constructr.comments && constructr.comments.length) {
                                flow.startJavaDocComments()
                                flow.push(constructr.comments)
                                flow.endJavaDocComments()
                            }

                            let escapedMethodName = type.getSimpleName()

                            flow.push(`public ${type.getSimpleName()}(`)
                            if (constructr.parameters)
                                flow.push(constructr.parameters.map(p => `${javaWriter.importTypeParametrized(p.type)} ${this.escapePropertyName(p.name)}`).join(', ')).push(`)`)

                            flow.push(`{\n}`).finishLine()
                        })
                    }

                    let nit = type.numberIndexType
                    if (nit) {
                        javaWriter.importType(this.JS_OVERLAY)
                        javaWriter.importType(this.JS)

                        flow.blankLine()
                        flow.push(`@JsOverlay`).finishLine()
                        flow.push(`${isClass ? 'public' : 'default'} void setByIndex(int index, ${javaWriter.importTypeParametrized(nit)} value) {`).finishLine()
                        flow.pushLineStart('    ')
                        flow.push(`Js.asArrayLike(this).setAt(index, value);`).finishLine()
                        flow.pullLineStart()
                        flow.push(`}`).finishLine()

                        flow.blankLine()
                        flow.push(`@JsOverlay`).finishLine()
                        flow.push(`${isClass ? 'public' : 'default'} ${javaWriter.importTypeParametrized(nit)} getByIndex(int index) {`).finishLine()
                        flow.pushLineStart('    ')
                        flow.push(`return (${javaWriter.importTypeParametrized(nit)}) Js.asArrayLike(this).getAt(index);`).finishLine()
                        flow.pullLineStart()
                        flow.push(`}`).finishLine()
                    }

                    let sit = type.stringIndexType
                    if (sit) {
                        javaWriter.importType(this.JS_OVERLAY)
                        javaWriter.importType(this.JS)

                        flow.blankLine()
                        flow.push(`@JsOverlay`).finishLine()
                        flow.push(`public void setByIndex(String index, ${javaWriter.importTypeParametrized(sit)} value) {`).finishLine()
                        flow.pushLineStart('    ')
                        flow.push(`Js.asPropertyMap(this).set(index, value);`).finishLine()
                        flow.pullLineStart()
                        flow.push(`}`).finishLine()

                        flow.blankLine()
                        flow.push(`@JsOverlay`).finishLine()
                        flow.push(`public ${javaWriter.importTypeParametrized(sit)} getByIndex(String index) {`).finishLine()
                        flow.pushLineStart('    ')
                        flow.push(`return (${javaWriter.importTypeParametrized(sit)}) Js.asPropertyMap(this).get(index);`).finishLine()
                        flow.pullLineStart()
                        flow.push(`}`).finishLine()
                    }

                    if (type.properties && type.properties.length) {
                        javaWriter.importType(this.JS_PROPERTY)

                        flow.blankLine()
                            .push('/*\n    Properties\n*/').finishLine()

                        type.properties.forEach(property => {
                            flow.blankLine()

                            if (property.comments && property.comments.length) {
                                flow.startJavaDocComments()
                                flow.push(property.comments)
                                flow.endJavaDocComments()
                            }

                            let escapedPropertyName = this.escapePropertyName(property.name)

                            if (isClass) {
                                if (escapedPropertyName != property.name)
                                    flow.push(`@JsProperty(name="${property.name}")`).finishLine()

                                flow.push(`public ${javaWriter.importTypeParametrized(property.type)} ${escapedPropertyName};`).finishLine()

                                flow.blankLine()
                            }

                            let upcaseName = escapedPropertyName.slice(0, 1).toLocaleUpperCase() + escapedPropertyName.slice(1)

                            let getterName = `get${upcaseName}`
                            let setterName = `set${upcaseName}`
                            if ((type as PreJavaTypeClassOrInterface).methods.some(m => m.name == getterName || m.name == setterName)) {
                                getterName = getterName + '__'
                                setterName = setterName + '__'
                            }

                            flow.push(`@JsProperty( name = "${property.name}")`).finishLine()
                            flow.push(`${isClass ? 'public native ' : ''}${javaWriter.importTypeParametrized(property.type)} ${getterName}();`).finishLine()

                            flow.blankLine()
                            flow.push(`@JsProperty( name = "${property.name}")`).finishLine()
                            flow.push(`${isClass ? 'public native ' : ''}void ${setterName}( ${javaWriter.importTypeParametrized(property.type)} value );`).finishLine()
                        })
                    }

                    if (type.methods && type.methods.length) {
                        flow.blankLine()
                            .push('/*\n    Methods\n*/').finishLine()

                        type.methods.filter(method => method.name != 'toString').forEach(method => {
                            if (method.comments && method.comments.length) {
                                flow.startJavaDocComments()
                                flow.push(method.comments)
                                flow.endJavaDocComments()
                            }

                            let escapedMethodName = this.escapePropertyName(method.name)

                            if (escapedMethodName != method.name) {
                                javaWriter.importType(this.JS_METHOD)
                                flow.push(`@JsMethod(name = "${method.name}")`).finishLine()
                            }
                            flow.push(`${isClass ? 'public native ' : ''}`)
                            if (method.typeParameters && method.typeParameters.length)
                                flow.push(`<${method.typeParameters.map(tp => tp.name).join(', ')}> `)
                            flow.push(`${javaWriter.importTypeParametrized(method.returnType)} ${escapedMethodName}(`)
                            if (method.parameters)
                                flow.push(method.parameters.map(p => `${javaWriter.importTypeParametrized(p.type)} ${this.escapePropertyName(p.name)}${p.dotdotdot ? ' /* ... */' : ''}${p.optional ? ' /* optional */' : ''}`).join(', '))
                            flow.push(`);`).finishLine()
                        })
                    }

                    flow.pullLineStart()

                    flow.push(`}`)
                    flow.finishLine()

                    this.exportJavaUnit(type, javaWriter, flow, baseDirectory)
                }
            })
        }
    }
}

