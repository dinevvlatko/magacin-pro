export const BrandMark=({className='' }:{className?:string})=><span className={`k2-brand-mark ${className}`.trim()}><img src="/branding/k2-vita-logo.jpg" alt="K2 Vita"/></span>

export const BrandLockup=({compact=false}:{compact?:boolean})=><div className={`k2-brand-lockup${compact?' compact':''}`}><BrandMark/><div><strong>K2 Vita</strong><small>Пакувај. Следи. Испорачај.</small></div></div>
