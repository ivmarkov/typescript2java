import * as ts from "typescript";
import * as BuiltIn from '../builtin-types'
import { PreJavaType, ProcessContext, TypeReplacer } from './PreJavaType'
import { PreJavaTypeParameter } from './PreJavaTypeParameter'
import { PreJavaTypeTPEnvironnement, PreJavaTypeReference } from './PreJavaTypeReference'
import { PreJavaTypeCallSignature, PreJavaTypeFormalParameter } from './PreJavaTypeCallSignature'
import * as Visit from './PreJavaTypeVisit'
import * as Signature from '../signature'
import * as tsTools from '../ts-tools'
import * as typeTools from '../type-tools'

let nextTypeId = 1

export interface PreJavaTypeProperty {
    name: string
    type: PreJavaType
    writable?: boolean
    comments?: string[]
}

export class PreJavaTypeClassOrInterface extends PreJavaType {
    // javascript information
    sourceTypes: Set<ts.Type> = new Set()
    isAnonymousSourceType = true
    jsNamespace: string = null
    jsName: string = null

    // java information
    name: string = null
    packageName: string
    isClass: boolean
    isFunctionalInterface: boolean
    typeParameters: PreJavaTypeParameter[] = null
    baseTypes = new Set<PreJavaType>()
    comments: string[]

    // content description
    constructorSignatures: PreJavaTypeCallSignature[] = []
    callSignatures: PreJavaTypeCallSignature[] = []
    properties: PreJavaTypeProperty[] = []
    methods: PreJavaTypeCallSignature[] = []
    staticProperties: PreJavaTypeProperty[] = []
    staticMethods: PreJavaTypeCallSignature[] = []
    numberIndexType: PreJavaType
    stringIndexType: PreJavaType

    getSourceTypes(): Set<ts.Type> { return this.sourceTypes }

    isClassLike() { return this.isClass }

    getHierachyDepth() {
        let level = 1
        if (this.baseTypes) {
            this.baseTypes.forEach(baseType => {
                let maybeLevel = 1 + baseType.getHierachyDepth()
                if (maybeLevel > level)
                    level = maybeLevel
            })
        }
        return level
    }

    removeMethod(method: PreJavaTypeCallSignature) {
        let index = this.methods.indexOf(method)
        if (index >= 0)
            this.methods.splice(index, 1)
    }

    processSourceType(type: ts.Type, typeParametersToApplyToAnonymousTypes: PreJavaTypeParameter[], context: ProcessContext) {
        if (!type || this.sourceTypes.has(type))
            return

        this.sourceTypes.add(type)

        this.extractName(type, context)
        this.extractTypeParameters(type as ts.ObjectType, typeParametersToApplyToAnonymousTypes, context)
        this.extractBaseTypes(type, typeParametersToApplyToAnonymousTypes, context)
        this.extractPrototypeAndNamespace(type, context)
        this.extractConstructor(type, context)
        this.extractComments(type)
        this.extractIndexTypes(type, context)
        this.extractPropertiesAndMethods(type as ts.InterfaceTypeWithDeclaredMembers, context)

        if (!this.name)
            console.log(`empty name`)
    }

    hasOnlyOneCallSignature() {
        if (!this.callSignatures || this.callSignatures.length != 1)
            return false
        if (this.constructorSignatures && this.constructorSignatures.length)
            return false
        if (this.methods && this.methods.length)
            return false
        if (this.numberIndexType || this.stringIndexType)
            return false
        if (this.properties && this.properties.length)
            return false
        if (this.staticMethods && this.staticMethods.length)
            return false
        if (this.staticProperties && this.staticProperties.length)
            return false
        return true
    }

    private extractTypeParameters(type: ts.Type, typeParametersToApplyToAnonymousTypes: PreJavaTypeParameter[], context: ProcessContext) {
        if (!(type.flags & ts.TypeFlags.Object))
            return

        let objectType = type as ts.ObjectType

        if (objectType.objectFlags & ts.ObjectFlags.Anonymous) {
            let usedTypeParameters = tsTools.fetchUsedFreeTypeParameters(type, context.getProgram().getTypeChecker())
            this.typeParameters = usedTypeParameters
                .map(typeParameterName => {
                    let typeParameter = new PreJavaTypeParameter(typeParameterName)
                    let existing = typeParametersToApplyToAnonymousTypes && typeParametersToApplyToAnonymousTypes.find(tp => tp.name == typeParameterName)
                    if (existing && existing.constraint)
                        typeParameter.constraint = existing.constraint
                    return typeParameter
                })
        }
        else if (objectType.objectFlags & ts.ObjectFlags.Class || objectType.objectFlags & ts.ObjectFlags.Interface) {
            let interfaceType = objectType as ts.InterfaceType

            if (interfaceType.typeParameters && interfaceType.typeParameters.length) {
                this.setTypeParameters(interfaceType.typeParameters.map(tp => {
                    let constraint: PreJavaType = null
                    if (tp.symbol && tp.symbol.declarations && tp.symbol.declarations[0] && tp.symbol.declarations[0].kind == ts.SyntaxKind.TypeParameter) {
                        let ss = tp.symbol.declarations[0] as ts.TypeParameterDeclaration
                        if (ss && ss.constraint)
                            constraint = context.getTypeMap().getOrCreatePreJavaTypeForTsType(context.getProgram().getTypeChecker().getTypeAtLocation(ss.constraint), false, null)
                    }

                    return new PreJavaTypeParameter(tp.symbol.getName(), constraint)
                }))
            }
        }
    }

    private extractBaseTypes(type: ts.Type, typeParametersToApplyToAnonymousTypes: PreJavaTypeParameter[], context: ProcessContext) {
        if (this.name == 'Observable')
            console.log(`yyyy`)
        /* ts.Type.getBaseTypes() does not return 'implemented' types, only 'extended'. We merge them in the PreJava tree */
        if (type.symbol && type.symbol.getDeclarations()) {
            type.symbol.getDeclarations().forEach(decl => {
                let classLikeDeclaration = decl as ts.ClassLikeDeclaration
                if (classLikeDeclaration.heritageClauses && classLikeDeclaration.heritageClauses.length) {
                    classLikeDeclaration.heritageClauses.forEach(heritageClause => {
                        heritageClause.types.forEach(baseTypeNode => {
                            let baseType = context.getProgram().getTypeChecker().getTypeAtLocation(baseTypeNode)
                            this.addBaseType(context.getTypeMap().getOrCreatePreJavaTypeForTsType(baseType, false, this.typeParameters))
                        })
                    })
                }
            })
        }
        else {
            let baseTypes = type.getBaseTypes()
            if (baseTypes) {
                baseTypes.forEach(baseType => {
                    this.addBaseType(context.getTypeMap().getOrCreatePreJavaTypeForTsType(baseType, false, this.typeParameters))
                })
            }
        }
    }

    private extractName(type: ts.Type, context: ProcessContext) {
        let symbol = type.getSymbol()

        if (symbol && ((symbol.flags & ts.SymbolFlags.Class) || (symbol.flags & ts.SymbolFlags.Interface))) {
            this.setSimpleName(symbol.getName())
            this.isAnonymousSourceType = false
        }
        else {
            this.setSimpleName(context.createAnonymousTypeName())
            this.isAnonymousSourceType = true
        }
    }

    private findConstructorOfType(type: ts.Type, typeEnv: { [key: string]: PreJavaType }, context: ProcessContext): PreJavaTypeCallSignature {
        let constructorSymbol = tsTools.getConstructorSymbolOfType(type, context.getProgram().getTypeChecker())
        if (constructorSymbol) {
            let signature = context.getTypeMap().convertSignature(null, constructorSymbol, this.typeParameters)

            if (typeEnv) {
                signature.parameters = signature.parameters.map(parameter => {
                    return {
                        name: parameter.name,
                        dotdotdot: parameter.dotdotdot,
                        optional: parameter.optional,
                        type: new PreJavaTypeTPEnvironnement(parameter.type, typeEnv)
                    }
                })
                signature.returnType = new PreJavaTypeTPEnvironnement(signature.returnType, typeEnv)
            }

            return signature
        }

        let baseTypes = type.getBaseTypes()
        if (baseTypes) {
            for (let baseType of baseTypes) {
                let preJavaType = context.getTypeMap().getOrCreatePreJavaTypeForTsType(baseType, false, this.typeParameters)

                Visit.visitPreJavaType(preJavaType, {
                    caseReferenceType: (refType) => {
                        let oldTypeEnv = typeEnv
                        typeEnv = {}
                        let referencedType = refType.type as PreJavaTypeClassOrInterface
                        for (let i = 0; i < referencedType.typeParameters.length; i++) {
                            // take into account previous environment
                            let value = refType.typeParameters[i]
                            if (value instanceof PreJavaTypeParameter && oldTypeEnv && value.name in oldTypeEnv) {
                                value = oldTypeEnv[value.name]
                            }
                            typeEnv[referencedType.typeParameters[i].name] = value
                        }
                    },
                    onOther: t => typeEnv = null
                })

                if (baseType.flags & ts.TypeFlags.Object) {
                    let objectType = baseType as ts.ObjectType
                    if (objectType.objectFlags & ts.ObjectFlags.Reference) {
                        let referenceType = objectType as ts.TypeReference
                        if (referenceType.target != baseType)
                            baseType = referenceType.target
                    }
                }

                let baseTypeConstructor = this.findConstructorOfType(baseType, typeEnv, context)
                if (baseTypeConstructor)
                    return baseTypeConstructor
            }
        }
        return null
    }

    private extractComments(type: ts.Type) {
        let symbol = type.getSymbol()
        if (!symbol)
            return

        let comments = this.getCommentFromSymbol(symbol)
        if (comments && comments.length > 0)
            this.addComments(comments)
    }

    private extractPrototypeAndNamespace(type: ts.Type, context: ProcessContext) {
        if (this.isAnonymousSourceType) {
            this.setPackageName(context.getJavaPackage(null))
            this.jsName = null
            this.jsNamespace = null
            return
        }

        let symbol = type.getSymbol()
        if (!symbol)
            return

        let declaration = symbol.valueDeclaration || (symbol.declarations && symbol.declarations.length && symbol.declarations[0])
        if (declaration) {
            let jsName = null
            if (declaration.kind == ts.SyntaxKind.ClassDeclaration) {
                jsName = tsTools.guessName((declaration as ts.ClassDeclaration).name)
                this.isClass = true
            }

            this.setPackageName(context.getJavaPackage(symbol))
            this.setPrototypeName(context.getJsPackage(symbol), jsName)
        }
    }

    private extractConstructor(type: ts.Type, context: ProcessContext) {
        let constructor = this.findConstructorOfType(type, null, context)
        if (constructor)
            this.addConstructorSignature(constructor)
    }

    private extractIndexTypes(type: ts.Type, context: ProcessContext) {
        let nit = type.getNumberIndexType()
        if (nit) {
            this.setNumberIndexType(context.getTypeMap().getOrCreatePreJavaTypeForTsType(nit, false, this.typeParameters))
        }

        let sit = type.getStringIndexType()
        if (sit) {
            this.setStringIndexType(context.getTypeMap().getOrCreatePreJavaTypeForTsType(sit, false, this.typeParameters))
        }
    }

    private extractPropertiesAndMethods(type: ts.InterfaceTypeWithDeclaredMembers, context: ProcessContext) {
        // static properties and methods
        if (type.symbol && type.symbol.valueDeclaration) {
            let declaredType = context.getProgram().getTypeChecker().getTypeOfSymbolAtLocation(type.symbol, type.symbol.valueDeclaration)
            if (declaredType) {
                let staticTypeProperties = declaredType.getProperties()
                staticTypeProperties && staticTypeProperties.forEach(property => {
                    if (property['parent'] == declaredType.symbol && property.name != 'prototype') {
                        let comments = this.getCommentFromSymbol(property) || []
                        let propertyType = context.getProgram().getTypeChecker().getTypeAtLocation(property.valueDeclaration)
                        let callSignatures = propertyType.getCallSignatures()
                        if (callSignatures && callSignatures.length && !(property.name.startsWith('on'))) {
                            for (let callSignature of callSignatures) {
                                let method = context.getTypeMap().convertSignature(property.name, callSignature, this.typeParameters)
                                if (method) {
                                    // TODO could reduce number of type paramaters, if some are not used
                                    if (this.typeParameters && this.typeParameters.length) {
                                        let toAdd = []
                                        for (let tp of this.typeParameters)
                                            if (!method.typeParameters || !method.typeParameters.some(p => p.name == tp.name))
                                                toAdd.push(tp.name)
                                        method.typeParameters = toAdd.map(name => new PreJavaTypeParameter(name)).concat(method.typeParameters ? method.typeParameters : [])
                                    }

                                    comments.push(`source : ${callSignature.declaration.getSourceFile().fileName}:${callSignature.declaration.getStart()}`)
                                    method.addComments(comments)
                                    this.addStaticMethod(method)
                                }
                            }
                        }
                        else {
                            let propertyPreJavaType = context.getTypeMap().getOrCreatePreJavaTypeForTsType(propertyType, false, this.typeParameters)
                            this.addStaticProperty({
                                name: property.name,
                                type: propertyPreJavaType,
                                writable: true,
                                comments
                            })
                        }
                    }
                })
            }
        }

        let properties = type.declaredProperties// type.getProperties()
        if (properties && properties.length) {
            properties.forEach(property => {
                let propertyName = property.getName()
                if (!property.valueDeclaration)
                    return

                let comments = this.getCommentFromSymbol(property)

                let propertyType = context.getProgram().getTypeChecker().getTypeAtLocation(property.valueDeclaration)

                // TODO : generating property accessors for callable types should be configurable
                let callSignatures = propertyType.getCallSignatures()
                if (callSignatures && callSignatures.length && !(propertyName.startsWith('on'))) {
                    let c = 0
                    for (let callSignature of callSignatures) {
                        let method = context.getTypeMap().convertSignature(propertyName, callSignature, this.typeParameters)
                        if (method) {
                            this.addTracabilityCommentsToMethod(method, callSignature)
                            method.addComments(comments)
                            if (c++ > 0)
                                method.comments.push(`VERSION ${c - 1}`)

                            this.addMethod(method)
                        }
                    }
                }
                else {
                    let propertyPreJavaType = context.getTypeMap().getOrCreatePreJavaTypeForTsType(propertyType, false, this.typeParameters)
                    this.addProperty({
                        name: propertyName,
                        type: propertyPreJavaType,
                        writable: true,
                        comments
                    })

                    // TODO : find another method name if it is already used...

                    let escapedPropertyName = typeTools.escapePropertyName(propertyName)
                    let upcaseName = escapedPropertyName.slice(0, 1).toLocaleUpperCase() + escapedPropertyName.slice(1)
                    let getterName = `get${upcaseName}`
                    let getterCallSignature = new PreJavaTypeCallSignature(null, propertyName, null, propertyPreJavaType, getterName, null)
                    let setterName = `set${upcaseName}`
                    let setterCallSignature = new PreJavaTypeCallSignature(null, propertyName, null, BuiltIn.BUILTIN_TYPE_UNIT, setterName, [{
                        dotdotdot: false,
                        optional: false,
                        type: propertyPreJavaType,
                        name: "value"
                    }])
                    this.addMethod(getterCallSignature)
                    this.addMethod(setterCallSignature)
                }
            })
        }

        let callSignatures = type.getCallSignatures()
        callSignatures && callSignatures.forEach(callSignature => {
            let signature = context.getTypeMap().convertSignature(null, callSignature, this.typeParameters)
            if (signature) {
                this.addTracabilityCommentsToMethod(signature, callSignature)
                this.addCallSignature(signature)
            }
        })
    }

    private addTracabilityCommentsToMethod(method: PreJavaTypeCallSignature, callSignature: ts.Signature) {
        method.addComments(`${callSignature.declaration.getSourceFile().fileName}@${callSignature.declaration.getStart()}`)
    }

    hasOnlyProperties() {
        if (this.baseTypes && this.baseTypes.size)
            return false

        if (this.constructorSignatures && this.constructorSignatures.length)
            return false

        if (this.methods && this.methods.length)
            return false
        if (this.staticMethods && this.staticMethods.length)
            return false
        if (this.staticProperties && this.staticProperties.length)
            return false

        return true
    }

    substituteTypeReal(replacer: TypeReplacer, cache: Map<PreJavaType, PreJavaType>, passThroughTypes: Set<PreJavaType>): PreJavaType {
        let stay = replacer(this)

        if (!stay || stay != this)
            return stay

        if (this.typeParameters)
            this.typeParameters = this.typeParameters.map(tp => tp.substituteType(replacer, cache, passThroughTypes)).filter(tp => tp != null) as PreJavaTypeParameter[]

        let baseTypes = this.baseTypes
        if (baseTypes) {
            this.baseTypes = new Set()
            baseTypes.forEach(type => {
                let sub = type.substituteType(replacer, cache, passThroughTypes)
                if (sub && sub != BuiltIn.BUILTIN_TYPE_OBJECT)
                    this.baseTypes.add(sub)
            })
        }

        if (this.constructorSignatures)
            this.constructorSignatures = this.constructorSignatures.map(s => s.substituteType(replacer, cache, passThroughTypes)).filter(s => s != null)

        if (this.callSignatures)
            this.callSignatures = this.callSignatures.map(s => s.substituteType(replacer, cache, passThroughTypes)).filter(s => s != null)

        if (this.staticProperties) {
            this.staticProperties = this.staticProperties.map(p => {
                p.type = p.type.substituteType(replacer, cache, passThroughTypes)
                if (!p.type)
                    return null
                return p
            }).filter(p => p != null)
        }

        if (this.staticMethods) {
            /*let olds = this.staticMethods
            this.staticMethods = []
            olds.forEach(old => {
                let subst = old.substituteType(replacer, cache, passThroughTypes)
                if (subst)
                    this.addStaticMethod(subst)
            })*/
            // TODO : this could make the different call signatures
            this.staticMethods = this.staticMethods.map(s => s.substituteType(replacer, cache, passThroughTypes)).filter(s => s != null)
        }

        if (this.properties) {
            this.properties = this.properties.map(p => {
                p.type = p.type.substituteType(replacer, cache, passThroughTypes)
                if (!p.type)
                    return null
                return p
            }).filter(p => p != null)
        }

        if (this.methods) {
            this.methods = this.methods.map(s => s.substituteType(replacer, cache, passThroughTypes)).filter(s => s != null)
        }

        if (this.numberIndexType)
            this.numberIndexType = this.numberIndexType.substituteType(replacer, cache, passThroughTypes)

        if (this.stringIndexType)
            this.stringIndexType = this.stringIndexType.substituteType(replacer, cache, passThroughTypes)

        return this
    }

    getPackageName() {
        return this.packageName
    }

    setPackageName(packageName: string) {
        if (!this.packageName)
            this.packageName = packageName
    }

    getTypeParameters(typeParametersEnv: { [key: string]: PreJavaType }) {
        if (!this.typeParameters || !typeParametersEnv)
            return this.typeParameters

        let res = []
        this.typeParameters.forEach(p => {
            if (typeParametersEnv && p.name in typeParametersEnv)
                res.push(typeParametersEnv[p.name])
            else
                res.push(p)
        })
        return res
    }

    setSimpleName(name: string) {
        if (name == '__type')
            return

        if (!this.name)
            this.name = name// + '__' + (nextTypeId++)
    }

    getSimpleName(typeParametersEnv: { [key: string]: PreJavaType }): string { return this.name }

    private addComments(lines: string[]) {
        if (!this.comments)
            this.comments = []
        lines && lines.forEach(l => this.comments.push(l))
    }

    dump() {
        console.log(`name: ${this.name}`)

        if (this.packageName)
            console.log(`package: ${this.packageName}`)

        if (this.typeParameters && this.typeParameters.length) {
            console.log(`type parameters: ${this.typeParameters.map(tp => tp.name).join(', ')}`)
        }

        if (this.baseTypes && this.baseTypes.size) {
            console.log('base types:')
            this.baseTypes.forEach(type => console.log(`- ${type.getParametrizedSimpleName(null)}`))
        }

        if (this.comments && this.comments.length) {
            console.log(`comments:`)
            this.comments.map(c => `/* ${c} */`).forEach(c => console.log(c))
        }

        console.log(`js name : ${this.jsNamespace} / ${this.jsName}`)

        if (this.constructorSignatures && this.constructorSignatures.length) {
            console.log(`constructors:`)
            for (let constructorSignature of this.constructorSignatures) {
                console.log(constructorSignature.serializeSignature(this.name))
            }
        }

        if (this.properties && this.properties.length) {
            console.log(`properties:`)
            for (let property of this.properties) {
                if (property.comments && property.comments.length)
                    console.log(property.comments.map(c => `/* ${c} */`).join('\n'))
                console.log(`${property.type.getParametrizedSimpleName(null)} ${property.name} ${property.writable ? '' : 'READ-ONLY'}`)
            }
        }

        if (this.numberIndexType) {
            console.log(`index by number: ${this.numberIndexType.getParametrizedSimpleName(null)}`)
        }
        if (this.stringIndexType) {
            console.log(`index by string: ${this.stringIndexType.getParametrizedSimpleName(null)}`)
        }

        if (this.methods && this.methods.length) {
            console.log(`methods:`)
            for (let method of this.methods) {
                console.log(method.serializeSignature())
            }
        }
    }

    setPrototypeName(namespace: string, name: string) {
        if (!name)
            return

        if ((this.jsName || this.jsNamespace) && (this.jsNamespace != namespace || this.jsName != name)) {
            console.log(`MULTIPLE PROTOTYPES when adding ${namespace}.${name}`)
            return
        }

        this.jsNamespace = namespace
        this.jsName = name

        //this.isClass = true
    }

    setTypeParameters(typeParameters: PreJavaTypeParameter[]) {
        if (!this.typeParameters)
            this.typeParameters = typeParameters
    }

    addBaseType(baseType: PreJavaType) {
        if (baseType && baseType != BuiltIn.BUILTIN_TYPE_OBJECT)
            this.baseTypes.add(baseType)
        if (baseType == null)
            console.log(`NULL BASE TYPE`)
    }

    addConstructorSignature(signature: PreJavaTypeCallSignature) {
        this.isClass = true
        if (!this.jsName) // TODO somethinig better
            this.jsName = this.name
        this.addMethodInCollection(signature, this.constructorSignatures)
    }

    addCallSignature(signature: PreJavaTypeCallSignature) {
        this.addMethodInCollection(signature, this.callSignatures)
    }

    addProperty(property: PreJavaTypeProperty) {
        if (property.name == 'length' && property.type == BuiltIn.BUILTIN_TYPE_NUMBER)
            property.type = BuiltIn.BUILTIN_TYPE_INT
        if (property.name == 'size' && property.type == BuiltIn.BUILTIN_TYPE_NUMBER)
            property.type = BuiltIn.BUILTIN_TYPE_INT
        this.properties.push(property)
    }

    cleanAndCheckMethods() {
    }

    addMethod(method: PreJavaTypeCallSignature): boolean {
        return this.addMethodInCollection(method, this.methods)
    }

    addMethodInCollection(method: PreJavaTypeCallSignature, methods: PreJavaTypeCallSignature[]): boolean {
        if (!method || method.name == 'toString')
            return false

        let sig = Signature.getCallSignatureTypeErasedSignature(method)
        if (methods.some(m => Signature.getCallSignatureTypeErasedSignature(m) == sig))
            return false

        methods.push(method)
        return true
    }

    addStaticProperty(property: PreJavaTypeProperty) {
        if (this.staticProperties && this.staticProperties.some(p => p.name == property.name))
            return // bug where static methods are duplicated
        this.staticProperties.push(property)
    }

    addStaticMethod(method: PreJavaTypeCallSignature) {
        if (!method)
            return

        this.addMethodInCollection(method, this.staticMethods)
    }

    setNumberIndexType(type: PreJavaType) {
        this.numberIndexType = type
    }

    setStringIndexType(type: PreJavaType) {
        this.stringIndexType = type
    }

    private getCommentFromSymbol(symbol: ts.Symbol): string[] {
        let comments = symbol && symbol.getDocumentationComment()
        if (comments && comments.length > 0) {
            let res = comments.map(c => c.text).filter(c => c != null && c.trim().length)
            if (res.length == 0)
                return null
            return res
        }

        return null
    }
}