#include "shared.h"
#include <openxr/openxr.h>
#include <openxr/openxr_loader_negotiation.h>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>
#define CHECK(x) do{if(!(x)){std::cerr<<"Failed: " #x " at "<<__LINE__<<"\n";std::exit(1);}}while(0)
namespace {
auto instance=reinterpret_cast<XrInstance>(1);
auto session=reinterpret_cast<XrSession>(2);
auto set=reinterpret_cast<XrActionSet>(3);
auto action=reinterpret_cast<XrAction>(4);
XrPath serial=10;
std::vector<XrActionSuggestedBinding> suggested;
std::vector<XrActionSet> attached;
std::vector<XrActiveActionSet> synced;
struct Pulse{XrPath hand;float amplitude;XrDuration duration;};
std::vector<Pulse> pulses;int stops=0,destroyed=0;
XrSessionState state=XR_SESSION_STATE_FOCUSED;
XrResult XRAPI_CALL make(const XrInstanceCreateInfo*,const XrApiLayerCreateInfo* chain,XrInstance* out){CHECK(!chain->nextInfo);*out=instance;return XR_SUCCESS;}
XrResult XRAPI_CALL destroy(XrInstance){destroyed++;return XR_SUCCESS;}
XrResult XRAPI_CALL make_session(XrInstance,const XrSessionCreateInfo*,XrSession* out){*out=session;return XR_SUCCESS;}
XrResult XRAPI_CALL drop_session(XrSession){return XR_SUCCESS;}
XrResult XRAPI_CALL make_set(XrInstance,const XrActionSetCreateInfo*,XrActionSet* out){*out=set;return XR_SUCCESS;}
XrResult XRAPI_CALL drop_set(XrActionSet){return XR_SUCCESS;}
XrResult XRAPI_CALL make_action(XrActionSet,const XrActionCreateInfo* info,XrAction* out){CHECK(info->actionType==XR_ACTION_TYPE_VIBRATION_OUTPUT&&info->countSubactionPaths==2);*out=action;return XR_SUCCESS;}
XrResult XRAPI_CALL path(XrInstance,const char*,XrPath* out){*out=++serial;return XR_SUCCESS;}
XrResult XRAPI_CALL suggest(XrInstance,const XrInteractionProfileSuggestedBinding* info){
    if(info->interactionProfile==99&&info->countSuggestedBindings>1)return XR_ERROR_PATH_UNSUPPORTED;
    suggested.assign(info->suggestedBindings,info->suggestedBindings+info->countSuggestedBindings);return XR_SUCCESS;
}
XrResult XRAPI_CALL attach(XrSession,const XrSessionActionSetsAttachInfo* info){attached.assign(info->actionSets,info->actionSets+info->countActionSets);return XR_SUCCESS;}
XrResult XRAPI_CALL sync(XrSession,const XrActionsSyncInfo* info){synced.assign(info->activeActionSets,info->activeActionSets+info->countActiveActionSets);return XR_SUCCESS;}
XrResult XRAPI_CALL poll(XrInstance,XrEventDataBuffer* out){auto* e=reinterpret_cast<XrEventDataSessionStateChanged*>(out);e->type=XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED;e->session=session;e->state=state;return XR_SUCCESS;}
XrResult XRAPI_CALL apply(XrSession,const XrHapticActionInfo* info,const XrHapticBaseHeader* header){
    auto* p=reinterpret_cast<const XrHapticVibration*>(header);CHECK(info->action==action&&p->duration>0&&p->duration<=100000000);
    pulses.push_back({info->subactionPath,p->amplitude,p->duration});return XR_SUCCESS;
}
XrResult XRAPI_CALL stop(XrSession,const XrHapticActionInfo*){stops++;return XR_SUCCESS;}
XrResult XRAPI_CALL bound(XrSession,const XrBoundSourcesForActionEnumerateInfo*,uint32_t,uint32_t* count,XrPath*){*count=2;return XR_SUCCESS;}
XrResult XRAPI_CALL get(XrInstance,const char* name,PFN_xrVoidFunction* fn){
#define FN(n,f) if(!std::strcmp(name,"xr" #n)){*fn=reinterpret_cast<PFN_xrVoidFunction>(f);return XR_SUCCESS;}
    FN(DestroyInstance,destroy) FN(CreateSession,make_session) FN(DestroySession,drop_session)
    FN(CreateActionSet,make_set) FN(DestroyActionSet,drop_set) FN(CreateAction,make_action) FN(StringToPath,path)
    FN(SuggestInteractionProfileBindings,suggest) FN(AttachSessionActionSets,attach) FN(SyncActions,sync)
    FN(PollEvent,poll) FN(ApplyHapticFeedback,apply) FN(StopHapticFeedback,stop)
    FN(EnumerateBoundSourcesForAction,bound)
#undef FN
    return XR_ERROR_FUNCTION_UNSUPPORTED;
}
}
int probe_loader(const char* path){
    std::wstring name=L"Local\\NFSU2LoaderProbe-"+std::to_wstring(GetCurrentProcessId());
    SetEnvironmentVariableW(haptics::map_env,name.c_str());haptics::Mapping mapping;CHECK(mapping.open(true));
    auto library=LoadLibraryA(path);CHECK(library);
    auto enumerate=reinterpret_cast<PFN_xrEnumerateApiLayerProperties>(GetProcAddress(library,"xrEnumerateApiLayerProperties"));CHECK(enumerate);
    uint32_t count=0;CHECK(enumerate(0,&count,nullptr)==XR_SUCCESS);
    std::vector<XrApiLayerProperties> layers(count,{XR_TYPE_API_LAYER_PROPERTIES});CHECK(enumerate(count,&count,layers.data())==XR_SUCCESS);
    bool found=false;for(auto& layer:layers)if(!std::strcmp(layer.layerName,haptics::layer_name))found=true;CHECK(found);
    auto create=reinterpret_cast<PFN_xrCreateInstance>(GetProcAddress(library,"xrCreateInstance"));CHECK(create);
    auto destroy=reinterpret_cast<PFN_xrDestroyInstance>(GetProcAddress(library,"xrDestroyInstance"));CHECK(destroy);
    XrInstanceCreateInfo info{XR_TYPE_INSTANCE_CREATE_INFO};strcpy_s(info.applicationInfo.applicationName,"NFSU2 browser haptics check");info.applicationInfo.apiVersion=XR_MAKE_VERSION(1,0,0);
    XrInstance value{};auto result=create(&info,&value);
    std::cout<<"OpenXR create result: "<<result<<"\n";CHECK(result==XR_SUCCESS);
    CHECK(GetModuleHandleW(L"nfsu2_web_haptics.dll"));CHECK(mapping.data->initialized==static_cast<LONG>(GetCurrentProcessId()));CHECK(destroy(value)==XR_SUCCESS);
    FreeLibrary(library);std::cout<<"PASS: real OpenXR loader discovers and loads the explicit haptics layer\n";return 0;
}
int main(int argc,char** argv){
    if(argc==3&&!std::strcmp(argv[1],"--loader"))return probe_loader(argv[2]);
    CHECK(argc==2);std::wstring name=L"Local\\NFSU2HapticsTest-"+std::to_wstring(GetCurrentProcessId());
    SetEnvironmentVariableW(haptics::map_env,name.c_str());haptics::Mapping mapping;CHECK(mapping.open(true));
    auto library=LoadLibraryA(argv[1]);CHECK(library);
    auto negotiate=reinterpret_cast<PFN_xrNegotiateLoaderApiLayerInterface>(GetProcAddress(library,"xrNegotiateLoaderApiLayerInterface"));CHECK(negotiate);
    XrNegotiateLoaderInfo loader{};loader.minInterfaceVersion=loader.maxInterfaceVersion=1;
    XrNegotiateApiLayerRequest api{};CHECK(negotiate(&loader,haptics::layer_name,&api)==XR_SUCCESS);
    XrApiLayerNextInfo next{};next.nextGetInstanceProcAddr=get;next.nextCreateApiLayerInstance=make;
    XrApiLayerCreateInfo chain{};chain.nextInfo=&next;XrInstance out{};XrInstanceCreateInfo info{XR_TYPE_INSTANCE_CREATE_INFO};
    CHECK(api.createApiLayerInstance(&info,&chain,&out)==XR_SUCCESS&&out==instance);
#define LOAD(n) PFN_xr##n call_##n=nullptr;CHECK(api.getInstanceProcAddr(instance,"xr" #n,reinterpret_cast<PFN_xrVoidFunction*>(&call_##n))==XR_SUCCESS)
    LOAD(CreateSession);LOAD(DestroySession);LOAD(DestroyInstance);LOAD(SuggestInteractionProfileBindings);LOAD(AttachSessionActionSets);LOAD(SyncActions);LOAD(PollEvent);
#undef LOAD
    XrSessionCreateInfo si{XR_TYPE_SESSION_CREATE_INFO};XrSession so{};CHECK(call_CreateSession(instance,&si,&so)==XR_SUCCESS);
    XrActionSuggestedBinding original{reinterpret_cast<XrAction>(5),100};
    XrInteractionProfileSuggestedBinding binding{XR_TYPE_INTERACTION_PROFILE_SUGGESTED_BINDING};binding.interactionProfile=50;binding.countSuggestedBindings=1;binding.suggestedBindings=&original;
    CHECK(call_SuggestInteractionProfileBindings(instance,&binding)==XR_SUCCESS&&suggested.size()==3&&suggested[0].action==original.action);
    CHECK(suggested[1].action==action&&suggested[2].action==action&&suggested[1].binding!=suggested[2].binding);
    binding.interactionProfile=99;CHECK(call_SuggestInteractionProfileBindings(instance,&binding)==XR_SUCCESS&&suggested.size()==1);
    XrActionSet original_set=reinterpret_cast<XrActionSet>(6);
    XrSessionActionSetsAttachInfo ai{XR_TYPE_SESSION_ACTION_SETS_ATTACH_INFO};ai.countActionSets=1;ai.actionSets=&original_set;
    CHECK(call_AttachSessionActionSets(session,&ai)==XR_SUCCESS&&attached.size()==2&&attached[0]==original_set&&attached[1]==set);
    XrActiveActionSet original_active{original_set,0};XrActionsSyncInfo sync_info{XR_TYPE_ACTIONS_SYNC_INFO};sync_info.countActiveActionSets=1;sync_info.activeActionSets=&original_active;
    XrEventDataBuffer event{XR_TYPE_EVENT_DATA_BUFFER};CHECK(call_PollEvent(instance,&event)==XR_SUCCESS);
    haptics::Packet p{GetTickCount64(),{.25f,.95f},{100,28}};haptics::publish(mapping.data,p);
    CHECK(call_SyncActions(session,&sync_info)==XR_SUCCESS&&synced.size()==2&&synced[0].actionSet==original_set);
    CHECK(pulses.size()==2&&pulses[0].amplitude==.25f&&pulses[1].amplitude==.95f&&pulses[0].hand!=pulses[1].hand);
    CHECK(mapping.data->applied==2&&mapping.data->bound==2&&mapping.data->output_at>0);
    call_SyncActions(session,&sync_info);CHECK(pulses.size()==2);
    Sleep(32);call_SyncActions(session,&sync_info);CHECK(stops==1);
    state=XR_SESSION_STATE_VISIBLE;call_PollEvent(instance,&event);CHECK(stops==2&&!mapping.data->focused);
    p.at=GetTickCount64();haptics::publish(mapping.data,p);call_SyncActions(session,&sync_info);CHECK(pulses.size()==2);
    state=XR_SESSION_STATE_FOCUSED;call_PollEvent(instance,&event);CHECK(pulses.size()==4);
    Sleep(105);call_SyncActions(session,&sync_info);CHECK(stops==4);
    p.at=GetTickCount64()-300;haptics::publish(mapping.data,p);call_SyncActions(session,&sync_info);CHECK(pulses.size()==4);
    CHECK(!haptics::valid(NAN,100)&&!haptics::valid(1,101)&&!haptics::valid(-1,10)&&haptics::valid(1,100));
    // A separate browser's capability probe must not clear an active owner.
    InterlockedExchange(&mapping.data->owner,12345);InterlockedExchange(&mapping.data->attached,1);
    InterlockedExchange64(&mapping.data->heartbeat,static_cast<LONG64>(GetTickCount64()));
    state=XR_SESSION_STATE_VISIBLE;call_PollEvent(instance,&event);
    CHECK(mapping.data->owner==12345&&mapping.data->attached==1);
    state=XR_SESSION_STATE_FOCUSED;call_PollEvent(instance,&event);CHECK(mapping.data->owner==12345);
    InterlockedExchange64(&mapping.data->heartbeat,static_cast<LONG64>(GetTickCount64()-1600));
    call_SyncActions(session,&sync_info);CHECK(mapping.data->owner==static_cast<LONG>(GetCurrentProcessId()));
    CHECK(call_DestroySession(session)==XR_SUCCESS&&!mapping.data->attached);
    CHECK(call_DestroyInstance(instance)==XR_SUCCESS&&destroyed==1);
    SetEnvironmentVariableW(haptics::map_env,nullptr);
    CHECK(api.createApiLayerInstance(&info,&chain,&out)==XR_SUCCESS);
    PFN_xrVoidFunction passed=nullptr;
    CHECK(api.getInstanceProcAddr(instance,"xrCreateSession",&passed)==XR_SUCCESS);
    CHECK(passed==reinterpret_cast<PFN_xrVoidFunction>(make_session));
    CHECK(api.getInstanceProcAddr(instance,"xrDestroyInstance",&passed)==XR_SUCCESS);
    CHECK(passed==reinterpret_cast<PFN_xrVoidFunction>(destroy));
    reinterpret_cast<PFN_xrDestroyInstance>(passed)(instance);
    FreeLibrary(library);std::cout<<"PASS: output bindings, original input sets, both hands, short clicks, focus loss, expiry and shutdown\n";
}
