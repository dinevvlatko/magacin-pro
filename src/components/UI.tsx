import type { ReactNode } from 'react'
export const Card=({children,className=''}:{children:ReactNode;className?:string})=><section className={`card ${className}`}>{children}</section>
export const PageHeader=({title,action}:{title:string;action?:ReactNode})=><div className="page-head"><div><h1>{title}</h1><p>MAGACIN PRO • локално и офлајн</p></div>{action}</div>
export const Empty=({text}:{text:string})=><div className="empty">{text}</div>
export const Modal=({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void})=><div className="modal-back" onMouseDown={onClose}><div className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose}>×</button></div>{children}</div></div>
export const Field=({label,children}:{label:string;children:ReactNode})=><label className="field"><span>{label}</span>{children}</label>
