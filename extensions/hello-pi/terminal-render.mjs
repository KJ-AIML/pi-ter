import {fields} from './assets/fields.mjs';
import {frameAt} from './scene.mjs';
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const dots=[[0,0,1],[0,1,2],[0,2,4],[1,0,8],[1,1,16],[1,2,32],[0,3,64],[1,3,128]];
const ramp=" .,:;irsXA253hMHGS#9B&@";

function surface(x,y,i) {
  const f=fields[i];
  // Extend only the wrist texture outside the supplied image's outer edge.
  if(i===0&&x<0)x=((x%24)+24)%24;
  if(i===1&&x>735)x=712+((x-736)%24);
  const xx=x-f.x,yy=y-f.y;
  if(xx<0||yy<0||xx>=f.w-1||yy>=f.h-1)return [0,0];
  const ix=Math.floor(xx),iy=Math.floor(yy),fx=xx-ix,fy=yy-iy;
  let a=0,l=0;
  for(let j=0;j<2;j++)for(let k=0;k<2;k++){
    const w=(k?fx:1-fx)*(j?fy:1-fy),at=((iy+j)*f.w+ix+k)*2;
    a+=f.data[at]*w/255;l+=f.data[at+1]*w/255;
  }
  return [a,l];
}

/** Terminal cells are the source of truth for terminal, browser and MP4. */
export function terminalCells(time,columns=120,rows=32,{mode='braille'}={}) {
  columns=Math.max(1,Math.floor(columns));rows=Math.max(1,Math.floor(rows));
  const t=Math.max(0,Math.min(6,time));
  const enter=smooth(t/1.45),reach=smooth((t-1.35)/1.4),release=smooth((t-3.15)/1.15),alpha=smooth(t/.65);
  const shifts=[[-115*(1-enter)+82*reach-62*release,28*reach-22*release],[115*(1-enter)-82*reach+62*release,-9*reach+7*release]];
  // Fit the actual hand composition instead of spending half the rows on black.
  const scale=Math.min(columns/736,rows*2/280),ox=(columns-736*scale)/2,oy=rows/2-225*scale/2;
  const cells=Array.from({length:rows},()=>Array.from({length:columns},()=>({ch:' ',shade:0,green:false})));
  for(let cy=0;cy<rows;cy++)for(let cx=0;cx<columns;cx++) {
    const wx=(cx-ox)/scale,wy=(cy-oy)*2/scale;
    const active=[0,1].filter(i=>{
      const f=fields[i],dx=shifts[i][0],dy=shifts[i][1];
      return wy+2/scale>=f.y+dy&&wy<=f.y+f.h+dy&&(i===0?wx<=f.x+f.w+dx:wx+1/scale>=f.x+dx);
    });
    if(active.length===0)continue;
    let bits=0,coverage=0,luma=0;
    for(const [sx,sy,bit] of dots){
      const x=(cx+(sx+.5)/2-ox)/scale,y=(cy+(sy+.5)/4-oy)*2/scale;
      let a=0,l=0;
      for(const i of active){
        const [sa,sl]=surface(x-shifts[i][0],y-shifts[i][1],i);
        if(sa>a){a=sa;l=sl;}
      }
      coverage+=a*alpha/8;luma+=l*a/8;
      const threshold=(bayer[((cy*4+sy)%4)*4+(cx*2+sx)%4]+.5)/16;
      if(a*alpha*(.42+.58*l)>threshold)bits|=bit;
    }
    if(coverage>.02){
      const light=clamp(luma/Math.max(coverage/Math.max(alpha,.001),.001));
      const shade=Math.round(9+14*light);
      const ch=mode==='ascii'?ramp[Math.round(clamp(coverage*(.18+.82*light))*(ramp.length-1))]:(bits?String.fromCodePoint(0x2800+bits):' ');
      cells[cy][cx]={ch,shade,green:false};
    }
  }
  const f=frameAt(t);
  for(const g of f.glyphs){
    if(!g.green||g.a<.14)continue;
    const x=Math.floor(g.x*scale+ox),y=Math.floor(g.y*scale/2+oy);
    if(x>=0&&y>=0&&x<columns&&y<rows&&cells[y][x].ch===' ')cells[y][x]={ch:g.ch,shade:23,green:true};
  }
  const ty=Math.floor(234*scale/2+oy),tx=Math.floor(357*scale+ox-f.text.length/2);
  if(f.textAlpha>.2&&ty>=0&&ty<rows){
    for(let i=-1;i<=f.text.length;i++)if(tx+i>=0&&tx+i<columns)cells[ty][tx+i]={ch:f.text[i]||' ',shade:23,green:true};
  }
  return cells;
}

export function terminalFrame(time,columns=120,rows=32,{color=true,mode='braille'}={}){
  return terminalCells(time,columns,rows,{mode}).map(row=>{
    let out='',previous='';
    for(const c of row){
      const code=c.green?'\x1b[92m':`\x1b[38;5;${232+c.shade}m`;
      if(color&&c.ch!==' '&&code!==previous){out+=code;previous=code;}
      out+=c.ch;
    }
    return out+(color?'\x1b[0m':'');
  });
}

export function drawTerminalFrame(ctx,time,width=1440,height=768,{columns=120,rows=32,mode='braille'}={}){
  const cw=Math.min(width/columns,height/rows/2),ch=cw*2;
  const ox=(width-columns*cw)/2,oy=(height-rows*ch)/2;
  ctx.fillStyle='#080a08';ctx.fillRect(0,0,width,height);
  ctx.font=`${cw/0.602}px "DejaVu Sans Mono", monospace`;ctx.textBaseline='middle';ctx.textAlign='left';
  const cells=terminalCells(time,columns,rows,{mode});
  cells.forEach((row,y)=>row.forEach((c,x)=>{
    if(c.ch===' ')return;
    const level=8+c.shade*10;
    ctx.fillStyle=c.green?'#69ff43':`rgb(${level},${level},${level})`;
    const braille=c.ch.codePointAt(0)>=0x2800;
    ctx.font=`${cw/0.602}px "${braille?'DejaVu Sans':'DejaVu Sans Mono'}", monospace`;
    ctx.fillText(c.ch,ox+x*cw,oy+(y+.5)*ch,cw);
  }));
}
