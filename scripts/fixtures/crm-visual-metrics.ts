/**
 * Read-only measurements of rendered employee content. Keep failures visible:
 * these measurements are not a substitute for action/role/overlay proofs.
 */
export const crmVisualMetricsExpression = `(()=>{
  const root=document.querySelector("main .crm-page") || document.querySelector(".crm-page");
  if(!root)return {status:"unavailable",reason:"No owned CRM page mounted"};
  const rgba=value=>{
    const numbers=value.match(/[\\d.]+/g)?.map(Number);
    if(value.startsWith("color(srgb "))return numbers?.length>=3?
      [numbers[0]*255,numbers[1]*255,numbers[2]*255,numbers[3]??1]:null;
    if(!value.startsWith("rgb"))return null;
    return numbers?.length>=3?[numbers[0],numbers[1],numbers[2],numbers[3]??1]:null;
  };
  const blend=(front,back)=>front.slice(0,3).map((n,i)=>n*front[3]+back[i]*(1-front[3]));
  const luminance=rgb=>rgb.map(n=>{const v=n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4})
    .reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
  const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  const violations=[],unmeasured=[];let measured=0;
  for(const element of root.querySelectorAll("*")){
    if(![...element.childNodes].some(node=>node.nodeType===3&&node.textContent.trim()))continue;
    const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
    if(!rect.width||!rect.height||rect.bottom<0||rect.top>innerHeight||style.visibility!=="visible")continue;
     // Closed details can retain layout rectangles. They are not painted text.
     if(!element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))continue;
    const ancestors=[];for(let parent=element;parent;parent=parent.parentElement)ancestors.unshift(parent);
    let background=[255,255,255],opacity=1,unsupported=false;
    for(const parent of ancestors){
      const paint=getComputedStyle(parent);opacity*=Number(paint.opacity);
      const color=rgba(paint.backgroundColor);
      if(paint.backgroundImage!=="none"||!color){unsupported=true;break;}
      background=blend(color,background);
    }
    const color=rgba(style.color);
    const descriptor={tag:element.tagName,testId:element.getAttribute("data-testid"),text:element.textContent.trim().slice(0,70)};
    if(unsupported||!color){unmeasured.push({...descriptor,reason:"Non-solid or unsupported paint"});continue;}
    // Composite final text opacity against its actual solid painted surface.
    const foreground=blend([color[0],color[1],color[2],color[3]*opacity],background);
    const ratio=contrast(foreground,background);
    const large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&Number(style.fontWeight)>=700);
    const threshold=large?3:4.5;
    const disabled=!!element.closest(":disabled,[aria-disabled=true]");
    measured++;
    if(ratio<threshold)violations.push({...descriptor,ratio,threshold,disabled,foreground,background,opacity});
  }
  const controls=[...root.querySelectorAll("button,input,select,textarea,[role=combobox],[role=tab]")].filter(e=>e.getClientRects().length)
    .map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,testId:e.getAttribute("data-testid"),width:r.width,height:r.height,
      disabled:e.matches(":disabled,[aria-disabled=true]"),ariaLabel:e.getAttribute("aria-label"),
      labelledBy:e.getAttribute("aria-labelledby"),labels:[...(e.labels??[])].map(label=>label.textContent.trim())};});
  const page=getComputedStyle(root);
  return {status:"measured",width:innerWidth,bodyWidth:document.documentElement.scrollWidth,
    font:page.fontFamily,gutter:parseFloat(page.paddingLeft),measuredText:measured,
    contrastViolations:violations,unmeasured,controls,
    reducedMotion:matchMedia("(prefers-reduced-motion:reduce)").matches};
})()`;
