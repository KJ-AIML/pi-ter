import { hands } from './assets/hands.mjs';

export const DURATION = 6;
export const clamp = (x, a=0, b=1) => Math.max(a,Math.min(b,x));
const smooth = x => { x=clamp(x); return x*x*(3-2*x); };
const lerp = (a,b,t) => a+(b-a)*t;

/** Pure, seekable scene. Time is in seconds, positions use the 736x480 reference. */
export function frameAt(time) {
  const t=clamp(time,0,DURATION);
  const enter=smooth(t/1.45), reach=smooth((t-1.35)/1.4), release=smooth((t-3.15)/1.15);
  const leftX=lerp(-115,0,enter)+82*reach-62*release;
  const rightX=lerp(115,0,enter)-82*reach+62*release;
  const leftY=28*reach-22*release, rightY=-9*reach+7*release;
  const alpha=smooth(t/.65);
  const glyphs=[];
  hands.forEach((hand,i)=>{
    const dx=i?rightX:leftX,dy=i?rightY:leftY;
    for (const [x,y,v,ch] of hand) {
      // A quiet travelling shimmer; geometry remains stable between frames.
      const shimmer=.90+.10*Math.sin(x*.026+y*.021-t*2.4);
      glyphs.push({x:x+dx,y:y+dy,ch,a:clamp(v*.55+.45)*alpha*shimmer,green:false});
    }
  });
  if(t>=2.7 && t<4.55) {
    const p=(t-2.7)/1.85;
    for(let i=0;i<100;i++) {
      const angle=i*2.399963, r=8+270*p*(.5+(i%11)/16);
      glyphs.push({x:357+Math.cos(angle)*r,y:232+Math.sin(angle)*r*.55,ch:'.:+*'[i%4],a:(1-p)**2*.8,green:true});
    }
  }
  let text='',textAlpha=1;
  if(t>.50 && t<1.65) {text='Hello World';textAlpha=smooth((t-.5)/.4);}
  else if(t>=1.65 && t<2.35) {
    const target='Hello World', n=Math.floor((t-1.65)*14);
    text=Array.from(target,(c,i)=>c===' '?' ':i<n?' .:+#'[Math.floor(t*21+i*3)%5]:c).join('');
    textAlpha=1-smooth((t-2.0)/.35);
  } else if(t>=3.4) {
    const target='Hello PI', n=Math.floor((t-3.4)*12);
    text=Array.from(target,(c,i)=>c===' '?' ':i<n?c:'_+:.#'[Math.floor(t*24+i*7)%5]).join('');
    textAlpha=smooth((t-3.4)/.4);
  }
  return {glyphs,text,textAlpha,t};
}

// Re-export the terminal renderer: previews use exactly the same cell grid.
export {terminalFrame,drawTerminalFrame as drawFrame} from './terminal-render.mjs';
