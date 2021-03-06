package fr.lteconsulting.jsinterop.browser;

import jsinterop.annotations.JsPackage;
import jsinterop.annotations.JsProperty;
import jsinterop.annotations.JsType;

/** 
  * base type: ExceptionInformation
  * flags: 32768
  * declared in: apis/browser-api/tsd/lib.es6.d.ts:258604
  * 
 */
@JsType(isNative=true, namespace=JsPackage.GLOBAL, name="ExceptionInformation")
public class ExceptionInformation
{

    /*
        Properties
    */

    public String domain;

    @JsProperty( name = "domain")
    public native String getDomain();

    @JsProperty( name = "domain")
    public native void setDomain( String value );
}
