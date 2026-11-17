// The native mod's seam contours, evaluated in the same authored mesh space.
export const LED_SHADER = `
fn trimLight(p: vec3f) -> f32 {
  let side=abs(p.x-.3116); var d=0.; var width=0.; var mask=0.;
  if(p.z < -.641) {
    d=p.z+.797-.355*side*side; width=.0045;
    mask=(1.-smoothstep(.605,.626,side))*smoothstep(-.27,-.245,p.y);
  } else if(p.z > .93) {
    d=p.y+.204; width=.003;
    mask=max(smoothstep(1.67,1.70,p.z),smoothstep(.608,.628,side))*smoothstep(.98,1.05,p.z)*(1.-smoothstep(.655,.677,side));
  } else if(side > .594) {
    d=p.y+.251+.018*abs(p.z); width=.003;
    let front=smoothstep(-.56,-.53,p.z)*(1.-smoothstep(.024,.047,p.z));
    let rear=smoothstep(.432,.456,p.z)*(1.-smoothstep(.833,.854,p.z));
    mask=(front+rear)*smoothstep(.595,.615,side)*(1.-smoothstep(.670,.697,side));
  } else if(p.x < .19 && p.z < -.466) {
    let lip=p.z+.570-.24*p.x;
    let hood=vec2f((p.x+.004)/.179,(p.y+.255-.065*p.x-.49*lip)/.127);
    d=(length(hood)-1.)*.139; width=.0018;
    mask=(1.-smoothstep(.026,.049,abs(lip)))*smoothstep(-.260,-.226,p.y);
  } else if(p.x > .477 && p.z < -.40) {
    d=p.y+.305; width=.0023;
    mask=smoothstep(.477,.49,p.x)*(1.-smoothstep(.89,.903,p.x))*(1.-smoothstep(.023,.042,abs(p.z+.49)));
  } else if(p.z < -.29) {
    d=side-(.096+.061*smoothstep(-.53,-.21,p.y)); width=.002;
    mask=smoothstep(-.552,-.527,p.y)*(1.-smoothstep(-.222,-.205,p.y))*(1.-smoothstep(.020,.042,abs(p.z+.439+.49*(p.y+.30))));
  } else {
    let corner=abs(p.xz-vec2f(.314,-.211))-vec2f(.055,.048);
    d=length(max(corner,vec2f(0.)))+min(max(corner.x,corner.y),0.)-.010; width=.0021;
    mask=1.-smoothstep(.015,.027,abs(p.y+.572));
  }
  let aa=max(.0003,.5*fwidth(d));
  let core=smoothstep(-aa,aa,d+width)-smoothstep(-aa,aa,d-width);
  return mask*(.84*core+.16*(1.-smoothstep(width,width+.012,abs(d))));
}`;
