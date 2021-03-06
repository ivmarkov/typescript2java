package fr.lteconsulting.jsinterop.browser;

import jsinterop.annotations.JsPackage;
import jsinterop.annotations.JsProperty;
import jsinterop.annotations.JsType;

/** 
  * base type: ElementTraversal
  * flags: 32768
  * declared in: apis/browser-api/tsd/lib.es6.d.ts:729271
  * 
 */
@JsType(isNative=true, namespace=JsPackage.GLOBAL, name="Object")
public interface ElementTraversal
{

    /*
        Properties
    */

    @JsProperty( name = "childElementCount")
    Number getChildElementCount();

    @JsProperty( name = "childElementCount")
    void setChildElementCount( Number value );

    @JsProperty( name = "firstElementChild")
    Element getFirstElementChild();

    @JsProperty( name = "firstElementChild")
    void setFirstElementChild( Element value );

    @JsProperty( name = "lastElementChild")
    Element getLastElementChild();

    @JsProperty( name = "lastElementChild")
    void setLastElementChild( Element value );

    @JsProperty( name = "nextElementSibling")
    Element getNextElementSibling();

    @JsProperty( name = "nextElementSibling")
    void setNextElementSibling( Element value );

    @JsProperty( name = "previousElementSibling")
    Element getPreviousElementSibling();

    @JsProperty( name = "previousElementSibling")
    void setPreviousElementSibling( Element value );
}
