import{R as V,j as o,g as P,h as F,r as v,O as I,V as w,s as x,m as M,n as $,Q as U,a7 as D,a8 as N,aJ as H,F as J,S as y,T as A}from"./index-Ck3WrSXQ.js";import{C as T}from"./IconLock-kzDNEGdt.js";function Q(t){return String(t).match(/[\d.\-+]*\s*(.*)/)[1]||""}function _(t){return parseFloat(t)}const G=V(o.jsx("path",{d:"M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"}));function Y(t){return P("MuiAvatar",t)}F("MuiAvatar",["root","colorDefault","circular","rounded","square","img","fallback"]);const Z=t=>{const{classes:r,variant:a,colorDefault:e}=t;return $({root:["root",a,e&&"colorDefault"],img:["img"],fallback:["fallback"]},Y,r)},tt=x("div",{name:"MuiAvatar",slot:"Root",overridesResolver:(t,r)=>{const{ownerState:a}=t;return[r.root,r[a.variant],a.colorDefault&&r.colorDefault]}})(U(({theme:t})=>({position:"relative",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,width:40,height:40,fontFamily:t.typography.fontFamily,fontSize:t.typography.pxToRem(20),lineHeight:1,borderRadius:"50%",overflow:"hidden",userSelect:"none",variants:[{props:{variant:"rounded"},style:{borderRadius:(t.vars||t).shape.borderRadius}},{props:{variant:"square"},style:{borderRadius:0}},{props:{colorDefault:!0},style:{color:(t.vars||t).palette.background.default,...t.vars?{backgroundColor:t.vars.palette.Avatar.defaultBg}:{backgroundColor:t.palette.grey[400],...t.applyStyles("dark",{backgroundColor:t.palette.grey[600]})}}}]}))),at=x("img",{name:"MuiAvatar",slot:"Img"})({width:"100%",height:"100%",textAlign:"center",objectFit:"cover",color:"transparent",textIndent:1e4}),rt=x(G,{name:"MuiAvatar",slot:"Fallback"})({width:"75%",height:"75%"});function et({crossOrigin:t,referrerPolicy:r,src:a,srcSet:e}){const[s,n]=v.useState(!1);return v.useEffect(()=>{if(!a&&!e)return;n(!1);let l=!0;const i=new Image;return i.onload=()=>{l&&n("loaded")},i.onerror=()=>{l&&n("error")},i.crossOrigin=t,i.referrerPolicy=r,i.src=a,e&&(i.srcset=e),()=>{l=!1}},[t,r,a,e]),s}const ot=v.forwardRef(function(r,a){const e=I({props:r,name:"MuiAvatar"}),{alt:s,children:n,className:l,component:i="div",slots:d={},slotProps:c={},imgProps:g,sizes:m,src:p,srcSet:h,variant:z="circular",...B}=e;let f=null;const u={...e,component:i,variant:z},W=et({...g,...typeof c.img=="function"?c.img(u):c.img,src:p,srcSet:h}),j=p||h,R=j&&W!=="error";u.colorDefault=!R,delete u.ownerState;const b=Z(u),[X,E]=w("root",{ref:a,className:M(b.root,l),elementType:tt,externalForwardedProps:{slots:d,slotProps:c,component:i,...B},ownerState:u}),[q,K]=w("img",{className:b.img,elementType:at,externalForwardedProps:{slots:d,slotProps:{img:{...g,...c.img}}},additionalProps:{alt:s,src:p,srcSet:h,sizes:m},ownerState:u}),[L,O]=w("fallback",{className:b.fallback,elementType:rt,externalForwardedProps:{slots:d,slotProps:c},shouldForwardComponentProp:!0,ownerState:u});return R?f=o.jsx(q,{...K}):n||n===0?f=n:j&&s?f=s[0]:f=o.jsx(L,{...O}),o.jsx(X,{...E,children:f})});function st(t){return P("MuiSkeleton",t)}F("MuiSkeleton",["root","text","rectangular","rounded","circular","pulse","wave","withChildren","fitContent","heightAuto"]);const nt=t=>{const{classes:r,variant:a,animation:e,hasChildren:s,width:n,height:l}=t;return $({root:["root",a,e,s&&"withChildren",s&&!n&&"fitContent",s&&!l&&"heightAuto"]},st,r)},C=N`
  0% {
    opacity: 1;
  }

  50% {
    opacity: 0.4;
  }

  100% {
    opacity: 1;
  }
`,S=N`
  0% {
    transform: translateX(-100%);
  }

  50% {
    /* +0.5s of delay between each loop */
    transform: translateX(100%);
  }

  100% {
    transform: translateX(100%);
  }
`,it=typeof C!="string"?D`
        animation: ${C} 2s ease-in-out 0.5s infinite;
      `:null,lt=typeof S!="string"?D`
        &::after {
          animation: ${S} 2s linear 0.5s infinite;
        }
      `:null,ct=x("span",{name:"MuiSkeleton",slot:"Root",overridesResolver:(t,r)=>{const{ownerState:a}=t;return[r.root,r[a.variant],a.animation!==!1&&r[a.animation],a.hasChildren&&r.withChildren,a.hasChildren&&!a.width&&r.fitContent,a.hasChildren&&!a.height&&r.heightAuto]}})(U(({theme:t})=>{const r=Q(t.shape.borderRadius)||"px",a=_(t.shape.borderRadius);return{display:"block",backgroundColor:t.vars?t.vars.palette.Skeleton.bg:t.alpha(t.palette.text.primary,t.palette.mode==="light"?.11:.13),height:"1.2em",variants:[{props:{variant:"text"},style:{marginTop:0,marginBottom:0,height:"auto",transformOrigin:"0 55%",transform:"scale(1, 0.60)",borderRadius:`${a}${r}/${Math.round(a/.6*10)/10}${r}`,"&:empty:before":{content:'"\\00a0"'}}},{props:{variant:"circular"},style:{borderRadius:"50%"}},{props:{variant:"rounded"},style:{borderRadius:(t.vars||t).shape.borderRadius}},{props:({ownerState:e})=>e.hasChildren,style:{"& > *":{visibility:"hidden"}}},{props:({ownerState:e})=>e.hasChildren&&!e.width,style:{maxWidth:"fit-content"}},{props:({ownerState:e})=>e.hasChildren&&!e.height,style:{height:"auto"}},{props:{animation:"pulse"},style:it||{animation:`${C} 2s ease-in-out 0.5s infinite`}},{props:{animation:"wave"},style:{position:"relative",overflow:"hidden",WebkitMaskImage:"-webkit-radial-gradient(white, black)","&::after":{background:`linear-gradient(
                90deg,
                transparent,
                ${(t.vars||t).palette.action.hover},
                transparent
              )`,content:'""',position:"absolute",transform:"translateX(-100%)",bottom:0,left:0,right:0,top:0}}},{props:{animation:"wave"},style:lt||{"&::after":{animation:`${S} 2s linear 0.5s infinite`}}}]}})),k=v.forwardRef(function(r,a){const e=I({props:r,name:"MuiSkeleton"}),{animation:s="pulse",className:n,component:l="span",height:i,style:d,variant:c="text",width:g,...m}=e,p={...e,animation:s,component:l,variant:c,hasChildren:!!m.children},h=nt(p);return o.jsx(ct,{as:l,ref:a,className:M(h.root,n),ownerState:p,...m,style:{width:g,height:i,...d}})});function dt(){return o.jsx(T,{sx:{padding:2},children:o.jsxs(y,{direction:"row",alignItems:"center",gap:2,children:[o.jsx(k,{variant:"circular",width:60,height:60}),o.jsxs(y,{direction:"column",gap:.5,flex:1,children:[o.jsx(k,{variant:"text",width:"70%",height:24}),o.jsx(k,{variant:"text",width:"30%",height:24})]})]})})}function ht({title:t,subtitle:r=null,href:a=null,openInNewTab:e=!1,icon:s,iconColor:n="primary",loading:l=!1}){const i={primary:"var(--sfd-primary)",secondary:"var(--sfd-secondary)",red:"var(--sfd-color-error)",green:"var(--sfd-color-success)",blue:"var(--sfd-color-info)",orange:"var(--sfd-color-warning)",text:"var(--sfd-text-color)"},d=a?H:J;return l?o.jsx(dt,{}):o.jsx(T,{children:o.jsx(d,{href:a,target:a&&e?"_blank":null,sx:{padding:2},children:o.jsxs(y,{direction:"row",alignItems:"center",gap:2,children:[o.jsx(ot,{sx:{width:60,height:60,bgcolor:i[n]??"var(--sfd-primary)",color:n==="text"?"var(--sfd-bg-color)":"white"},children:s?o.jsx(s,{size:40,stroke:1}):null}),o.jsxs(y,{direction:"column",gap:.5,children:[o.jsx(A,{variant:"h4",children:t}),r!==null?o.jsx(A,{variant:"body1",className:"waiting",children:r}):null]})]})})})}export{ht as C,k as S};
