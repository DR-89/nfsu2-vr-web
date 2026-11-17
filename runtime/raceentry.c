#include "raceentry.h"
#include "raceactions.h"
#include "guest.h"
#include "game.h"
#include "mprace.h"
#include <string.h>
#include <stdio.h>

int career_fe_active(const char *);
int savegame_busy(void);
int winsock_online(void);
int roam_game_alone(void);
int roam_exploring(void);

/* The browser owns only its trip. It never starts an mprace, awards money,
 * alters career progress or handles the original save/error questions. */
enum { E_IDLE,E_OUT,E_LOGIN,E_OPEN,E_LEAVE,E_CAREER,E_RESUME,E_CRIB,E_LOAD,E_ERROR };
static struct {
    unsigned state,career,spot,carset;
    double since,next,crib_at;
    uint32_t car,qr,category;
    uint8_t profile[33],keep,position[12],heading[2];
} entry;
static uint32_t strings;
static int on(const char *name){ return career_fe_active(name); }
static unsigned flow(void){ return guest_rd32(G_FLOW); }
static unsigned mode(void){ return guest_rd32(G_GAMEMODE); }
static int paused(void){ return flow()==6 && guest_rd32(guest_rd32(G_RACESTATUS))==6 && on("UI_Pause.fng"); }
static int main_menu(void){ return flow()==3 && mode()==2 && on("UI_Main.fng"); }
static int trip_other(void){ unsigned p=mprace_phase();return p>=MPR_OUT && p<=MPR_BACK; }
static int can_enter(void){
    if(entry.state || !winsock_online() || savegame_busy() || guest_rd32(G_RB_DIALOG) || trip_other())return 0;
    if(main_menu())return 1;
    return paused() && mode()==1 && !guest_rd32(G_RACETYPE) && !guest_rd32(G_CAREER_RACE) &&
        guest_rd32(G_RACEPARAMS+0x20u)==1 && roam_exploring() && roam_game_alone();
}
static int can_exit(void){
    if((entry.state!=E_OPEN && entry.state!=E_ERROR) || savegame_busy() || guest_rd32(G_RB_DIALOG))return 0;
    return flow()==3 || (mode()==8 && paused());
}
unsigned raceentry_flags(void){
    if(!entry.state)return can_enter()?RE_CAN_ENTER:0;
    return RE_ACTIVE | (entry.career?RE_CAREER:0) | (can_exit()?RE_CAN_EXIT:0) |
        (entry.state==E_ERROR?RE_FAILED:entry.state!=E_OPEN?RE_BUSY:0);
}
int raceentry_owns_input(void){
    return entry.state && entry.state!=E_OPEN && entry.state!=E_ERROR && !savegame_busy() && !guest_rd32(G_RB_DIALOG);
}
static void phase(unsigned state,double now){
    entry.state=state;entry.since=now;entry.next=now+180;
    fprintf(stderr,"[races] entry phase %u%s\n",state,entry.career?" (career return)":"");
}
static int arena(CPU *c){
    if(!strings){uint32_t n=128;strings=gcall_main(c,FN_NEW,0,1,&n);}
    if(!strings || !guest_ok_bytes(strings,128))return 0;
    guest_write_str(strings,"UI_Pause.fng",32);guest_write_str(strings+32,"UI_StartCareer.fng",32);
    guest_write_str(strings+64,"UI_CareerCrib.fng",32);return 1;
}
static void send(CPU *c,uint32_t message,uint32_t pack){uint32_t a[2]={message,pack};gcall_main(c,FN_RB_SEND,0,2,a);}
static void switch_to(CPU *c,uint32_t from,uint32_t to){uint32_t a[3]={from,to,0};gcall_main(c,FN_RB_SWITCH,0,3,a);}
static int same_profile(void){return guest_ok_bytes(G_PROFILE_NAME,33) && !memcmp(entry.profile,g_mem+G_PROFILE_NAME,33);}
static void restore_car(void){
    if(!entry.carset || !same_profile())return;
    if(guest_rd32(G_QR_CAR)==entry.car && guest_rd32(G_QR_CAR_CATEGORY)==4){
        MR32(G_QR_CAR)=entry.qr;MR32(G_QR_CAR_CATEGORY)=entry.category;
    }
    entry.carset=0;
}
static void done(void){restore_car();memset(&entry,0,sizeof entry);fprintf(stderr,"[races] entry trip complete\n");}
unsigned raceentry_enter(CPU *c,double now){
    if(!can_enter())return RA_UNAVAILABLE;
    if(!guest_ok_bytes(G_PROFILE_NAME,33) || !arena(c))return RA_FAILED;
    memset(&entry,0,sizeof entry);memcpy(entry.profile,g_mem+G_PROFILE_NAME,33);
    entry.career=mode()==1;entry.car=guest_rd32(G_CAREER_CAR);
    entry.qr=guest_rd32(G_QR_CAR);entry.category=guest_rd32(G_QR_CAR_CATEGORY);
    phase(E_OUT,now);return RA_ACCEPTED;
}
unsigned raceentry_exit(CPU *c,double now){
    (void)c;if(!can_exit())return RA_UNAVAILABLE;phase(E_LEAVE,now);return RA_ACCEPTED;
}
static void keep_spot(void){
    if(!entry.career || entry.spot || !guest_ok_bytes(G_START_KEEP,1) || !guest_ok_bytes(G_START_POS,12) || !guest_ok_bytes(G_START_HEAD,2))return;
    entry.keep=MR8(G_START_KEEP);memcpy(entry.position,g_mem+G_START_POS,12);memcpy(entry.heading,g_mem+G_START_HEAD,2);entry.spot=1;
}
static void restore_spot(void){
    if(!entry.spot || !same_profile() || !guest_ok_bytes(G_START_KEEP,1) || !guest_ok_bytes(G_START_POS,12) || !guest_ok_bytes(G_START_HEAD,2))return;
    MR8(G_START_KEEP)=entry.keep;memcpy(g_mem+G_START_POS,entry.position,12);memcpy(g_mem+G_START_HEAD,entry.heading,2);
}
void raceentry_frame(CPU *c,double now){
    if(!entry.state)return;
    if(!same_profile()){memset(&entry,0,sizeof entry);fprintf(stderr,"[races] entry released: game profile changed\n");return;}
    if(savegame_busy() || guest_rd32(G_RB_DIALOG)){entry.since=now;return;}
    if(now<entry.next)return;
    /* Early careers can resume directly into the world without visiting the
     * crib. The original coordinator, rather than a particular menu path,
     * decides when this return has finished. */
    if(entry.career && ((entry.state>=E_RESUME && entry.state<=E_LOAD) || entry.state==E_ERROR) && flow()==6 && mode()==1 &&
       !guest_rd32(G_RACETYPE) && guest_rd32(guest_rd32(G_RACESTATUS))==4 && on("HUD_SingleRace.fng")){done();return;}
    if(entry.state!=E_OPEN && entry.state!=E_ERROR && now-entry.since>120000){phase(E_ERROR,now);return;}
    if(entry.state==E_ERROR)return;
    if(entry.state==E_OUT){
        if(main_menu()){
            keep_spot();MR32(G_GAMEMODE)=8;
            uint32_t pack=S_RB_MAIN;gcall_main(c,FN_RB_LOGIN,0,1,&pack);phase(E_LOGIN,now);
        }else if(paused() && mode()==1){send(c,MSG_RB_QUIT_YES,strings);entry.next=now+1500;}
    }else if(entry.state==E_LOGIN){
        if(main_menu()){phase(E_ERROR,now);return;}
        if(flow()==3 && mode()==8 && on("UI_OLMAIN.fng") && guest_rd32(G_ONLINE_PROFILE+0x50u)==17){
            if(entry.career){
                if(guest_rd32(G_CAREER_CAR)!=entry.car){phase(E_ERROR,now);return;}
                /* The prologue's borrowed 350Z has no front-end car record.
                 * Keep the normal Quick Race selection until a car is owned;
                 * an invalid handle would give the original loader garbage. */
                if(mprace_car_ok()){MR32(G_QR_CAR)=entry.car;MR32(G_QR_CAR_CATEGORY)=4;entry.carset=1;}
            }
            switch_to(c,S_RB_OLMAIN,S_RB_LOBBY);phase(E_OPEN,now);
        }else if(on("UI_OLEALogin.fng") || on("UI_OLUseExisting.fng"))phase(E_ERROR,now);
    }else if(entry.state==E_OPEN){
        if(main_menu()){if(entry.career)phase(E_CAREER,now);else done();}
    }else if(entry.state==E_LEAVE){
        if(main_menu()){if(entry.career)phase(E_CAREER,now);else done();return;}
        if(paused() && mode()==8){send(c,MSG_RB_QUIT_YES,strings);entry.next=now+1500;return;}
        if(flow()!=3 || mode()!=8)return;
        uint32_t pack=0;
        if(on("PC_OL_GameRoom.fng"))pack=guest_rd32(G_RB_ROOM_NAME);
        else if(on("PC_OL_Lobby.fng"))pack=S_RB_LOBBY;
        else if(on("UI_OLMAIN.fng"))pack=S_RB_OLMAIN;
        if(pack){gcall_main(c,FN_RB_DISCONNECT,0,1,&pack);entry.next=now+1500;}
    }else if(entry.state==E_CAREER){
        if(!main_menu())return;
        if(guest_rd32(G_RACEPARAMS)!=2000 || guest_rd32(G_RACETYPE) || guest_rd32(G_RACEPARAMS+0x74u))
            gcall_main(c,FN_RB_RESET_PARAMS,G_RACEPARAMS,0,0);
        restore_car();restore_spot();switch_to(c,S_RB_MAIN,strings+32);phase(E_RESUME,now);
    }else if(entry.state==E_RESUME){
        if(on("UI_StartCareer.fng")){uint32_t one=1;gcall_main(c,FN_RB_RESUME,0,1,&one);phase(E_CRIB,now);}
    }else if(entry.state==E_CRIB){
        if(!on("UI_CareerCrib.fng")){entry.crib_at=0;return;}
        if(!entry.crib_at)entry.crib_at=now;
        if(!guest_rd32(G_PROFILE_SNAPSHOT) && (guest_rd32(G_PROFILE_AUTOSAVE) || now-entry.crib_at<3000))return;
        restore_spot();send(c,MSG_RB_EXPLORE,strings+64);phase(E_LOAD,now);
    }else if(entry.state==E_LOAD){
        if(main_menu())phase(E_CAREER,now); /* a cancelled autosave returns through the original main menu */
    }
}
