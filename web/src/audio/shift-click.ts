/** The existing native mod's vr_music.cpp click: 960 samples at 48 kHz,
 * 1,800 Hz with a squared decay and peak scale 2,800/32,768. */
export class ShiftClickSound {
  private buffer:AudioBuffer|null=null;
  private source:AudioBufferSourceNode|null=null;
  play(context:AudioContext,output:AudioNode):void {
    this.stop();
    if(!this.buffer) {
      this.buffer=context.createBuffer(1,960,48000);
      const samples=this.buffer.getChannelData(0);
      for(let i=0;i<samples.length;i++)samples[i]=Math.trunc(2800*((960-i)/960)**2*Math.sin(i*.23561945))/32768;
    }
    const source=this.source=context.createBufferSource();source.buffer=this.buffer;source.connect(output);
    source.onended=()=>{source.disconnect();if(this.source===source)this.source=null;};source.start();
  }
  stop():void {
    const source=this.source;this.source=null;
    if(source){source.onended=null;try{source.stop();}catch{/* already ended */}source.disconnect();}
  }
}
