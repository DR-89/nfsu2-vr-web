#include "shared.h"
#include <openxr/openxr.h>
#include <openxr/openxr_loader_negotiation.h>
#include <algorithm>
#include <mutex>
#include <vector>

// Automatic registration is per Windows user. Only browser processes and the
// explicit diagnostic channel acquire output actions; other XR apps pass through.
namespace {
std::recursive_mutex mutex;
haptics::Mapping mapping;
XrInstance instance=XR_NULL_HANDLE;
XrSession session=XR_NULL_HANDLE;
XrActionSet action_set=XR_NULL_HANDLE;
XrAction action=XR_NULL_HANDLE;
XrPath hands[2]{},outputs[2]{};
bool attached=false,focused=false;
LONG sent_sequence=-1;
ULONGLONG bound_checked=0;
bool playing[2]{};
PFN_xrGetInstanceProcAddr next_get=nullptr;
#define XR_FUNCTIONS(X) X(DestroyInstance) X(CreateSession) X(DestroySession) X(CreateActionSet) X(DestroyActionSet) X(CreateAction) X(StringToPath) X(SuggestInteractionProfileBindings) X(AttachSessionActionSets) X(SyncActions) X(PollEvent) X(ApplyHapticFeedback) X(StopHapticFeedback) X(EnumerateBoundSourcesForAction)
#define DECLARE(name) PFN_xr##name next_##name=nullptr;
XR_FUNCTIONS(DECLARE)
#undef DECLARE
void stop() {
    if(session&&action)for(int h=0;h<2;h++)if(playing[h]){
        XrHapticActionInfo info{XR_TYPE_HAPTIC_ACTION_INFO};info.action=action;info.subactionPath=hands[h];
        next_StopHapticFeedback(session,&info);playing[h]=false;
    }
    sent_sequence=-1;
}
void update() {
    auto* shared=mapping.data;if(!shared)return;
    auto now=GetTickCount64();auto pid=static_cast<LONG>(GetCurrentProcessId());
    auto owner=InterlockedCompareExchange(&shared->owner,0,0);
    if(!attached||!focused){
        stop();
        if(owner==pid){InterlockedExchange(&shared->attached,0);InterlockedExchange(&shared->focused,0);InterlockedCompareExchange(&shared->owner,0,pid);}
        return;
    }
    if(owner!=pid){
        auto beat=InterlockedCompareExchange64(&shared->heartbeat,0,0);
        if(owner&&now-static_cast<uint64_t>(beat)<1500){stop();return;}
        if(InterlockedCompareExchange(&shared->owner,pid,owner)!=owner){stop();return;}
    }
    InterlockedExchange64(&shared->heartbeat,static_cast<LONG64>(now));
    InterlockedExchange(&shared->attached,1);InterlockedExchange(&shared->focused,1);
    if(now-bound_checked>=1000){
        bound_checked=now;uint32_t count=0;
        XrBoundSourcesForActionEnumerateInfo binding{XR_TYPE_BOUND_SOURCES_FOR_ACTION_ENUMERATE_INFO};binding.action=action;
        auto result=next_EnumerateBoundSourcesForAction(session,&binding,0,&count,nullptr);
        InterlockedExchange(&shared->bound,XR_SUCCEEDED(result)?static_cast<LONG>(count):0);
    }
    haptics::Packet p{};LONG seq=0;
    if(!haptics::read(shared,p,seq)||now<p.at||now-p.at>=150){stop();return;}
    for(int h=0;h<2;h++) {
        XrHapticActionInfo info{XR_TYPE_HAPTIC_ACTION_INFO};info.action=action;info.subactionPath=hands[h];
        auto age=now-p.at;
        if(p.amplitude[h]<=0||age>=p.duration[h]) {
            if(playing[h])next_StopHapticFeedback(session,&info);
            playing[h]=false;continue;
        }
        if(seq==sent_sequence)continue;
        XrHapticVibration pulse{XR_TYPE_HAPTIC_VIBRATION};pulse.amplitude=p.amplitude[h];
        pulse.duration=static_cast<XrDuration>(p.duration[h]-age)*1000000;
        pulse.frequency=XR_FREQUENCY_UNSPECIFIED;
        auto result=next_ApplyHapticFeedback(session,&info,reinterpret_cast<const XrHapticBaseHeader*>(&pulse));
        InterlockedExchange(&shared->result,result);playing[h]=result==XR_SUCCESS;
        if(playing[h]){InterlockedIncrement(&shared->applied);InterlockedExchange64(&shared->output_at,static_cast<LONG64>(now));}
        else InterlockedIncrement(&shared->rejected);
    }
    sent_sequence=seq;
}
XrResult XRAPI_CALL destroy_instance(XrInstance value) {
    std::lock_guard lock(mutex);stop();
    if(action_set)next_DestroyActionSet(action_set);
    action=XR_NULL_HANDLE;action_set=XR_NULL_HANDLE;instance=XR_NULL_HANDLE;session=XR_NULL_HANDLE;attached=focused=false;
    update();
    if(mapping.data&&!mapping.data->owner)InterlockedCompareExchange(&mapping.data->initialized,0,static_cast<LONG>(GetCurrentProcessId()));
    return next_DestroyInstance(value);
}
XrResult XRAPI_CALL create_session(XrInstance value,const XrSessionCreateInfo* info,XrSession* out) {
    std::lock_guard lock(mutex);auto result=next_CreateSession(value,info,out);
    if(XR_SUCCEEDED(result)&&!session){session=*out;attached=focused=false;sent_sequence=-1;bound_checked=0;}
    return result;
}
XrResult XRAPI_CALL destroy_session(XrSession value) {
    std::lock_guard lock(mutex);
    if(value==session){stop();session=XR_NULL_HANDLE;attached=focused=false;update();}
    return next_DestroySession(value);
}
XrResult XRAPI_CALL suggest(XrInstance value,const XrInteractionProfileSuggestedBinding* info) {
    std::lock_guard lock(mutex);
    if(!action)return next_SuggestInteractionProfileBindings(value,info);
    std::vector<XrActionSuggestedBinding> bindings(info->suggestedBindings,info->suggestedBindings+info->countSuggestedBindings);
    for(auto output:outputs)bindings.push_back({action,output});
    auto copy=*info;copy.suggestedBindings=bindings.data();copy.countSuggestedBindings=static_cast<uint32_t>(bindings.size());
    auto result=next_SuggestInteractionProfileBindings(value,&copy);
    // Hand/eye profiles need not expose a vibration path. Keep their original bindings.
    return XR_FAILED(result)?next_SuggestInteractionProfileBindings(value,info):result;
}
XrResult XRAPI_CALL attach(XrSession value,const XrSessionActionSetsAttachInfo* info) {
    std::lock_guard lock(mutex);
    if(value!=session||!action_set)return next_AttachSessionActionSets(value,info);
    std::vector<XrActionSet> sets(info->actionSets,info->actionSets+info->countActionSets);sets.push_back(action_set);
    auto copy=*info;copy.actionSets=sets.data();copy.countActionSets=static_cast<uint32_t>(sets.size());
    auto result=next_AttachSessionActionSets(value,&copy);attached=XR_SUCCEEDED(result);update();return result;
}
XrResult XRAPI_CALL sync(XrSession value,const XrActionsSyncInfo* info) {
    std::lock_guard lock(mutex);
    if(value!=session||!attached)return next_SyncActions(value,info);
    std::vector<XrActiveActionSet> sets(info->activeActionSets,info->activeActionSets+info->countActiveActionSets);sets.push_back({action_set,XR_NULL_PATH});
    auto copy=*info;copy.activeActionSets=sets.data();copy.countActiveActionSets=static_cast<uint32_t>(sets.size());
    auto result=next_SyncActions(value,&copy);
    if(result==XR_SESSION_NOT_FOCUSED)focused=false;
    if(XR_SUCCEEDED(result))update();else stop();return result;
}
XrResult XRAPI_CALL poll(XrInstance value,XrEventDataBuffer* event) {
    std::lock_guard lock(mutex);auto result=next_PollEvent(value,event);
    if(result==XR_SUCCESS&&event->type==XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED){
        auto* state=reinterpret_cast<XrEventDataSessionStateChanged*>(event);
        if(state->session==session){focused=state->state==XR_SESSION_STATE_FOCUSED;update();}
    }
    return result;
}
XrResult XRAPI_CALL get(XrInstance value,const char* name,PFN_xrVoidFunction* fn) {
    if(!name||!fn)return XR_ERROR_VALIDATION_FAILURE;
    if(!instance)return next_get?next_get(value,name,fn):XR_ERROR_FUNCTION_UNSUPPORTED;
    struct Entry{const char* name;PFN_xrVoidFunction fn;};
    const Entry entries[]={{"xrDestroyInstance",reinterpret_cast<PFN_xrVoidFunction>(destroy_instance)},
        {"xrCreateSession",reinterpret_cast<PFN_xrVoidFunction>(create_session)},{"xrDestroySession",reinterpret_cast<PFN_xrVoidFunction>(destroy_session)},
        {"xrSuggestInteractionProfileBindings",reinterpret_cast<PFN_xrVoidFunction>(suggest)},{"xrAttachSessionActionSets",reinterpret_cast<PFN_xrVoidFunction>(attach)},
        {"xrSyncActions",reinterpret_cast<PFN_xrVoidFunction>(sync)},{"xrPollEvent",reinterpret_cast<PFN_xrVoidFunction>(poll)}};
    for(const auto& entry:entries)if(!std::strcmp(name,entry.name)){*fn=entry.fn;return XR_SUCCESS;}
    return next_get?next_get(value,name,fn):XR_ERROR_FUNCTION_UNSUPPORTED;
}
XrResult XRAPI_CALL create(const XrInstanceCreateInfo* info,const XrApiLayerCreateInfo* chain,XrInstance* out) {
    std::lock_guard lock(mutex);
    if(!chain||!chain->nextInfo||!out)return XR_ERROR_INITIALIZATION_FAILED;
    if(instance)return XR_ERROR_LIMIT_REACHED;
    auto* next=chain->nextInfo;auto copy=*chain;copy.nextInfo=next->next;
    next_get=next->nextGetInstanceProcAddr;
    wchar_t executable[MAX_PATH]{},explicit_map[160]{};
    GetModuleFileNameW(nullptr,executable,MAX_PATH);
    const wchar_t* base=wcsrchr(executable,L'\\');base=base?base+1:executable;
    bool browser=!_wcsicmp(base,L"chrome.exe")||!_wcsicmp(base,L"msedge.exe");
    auto result=next->nextCreateApiLayerInstance(info,&copy,out);if(XR_FAILED(result))return result;
    if(!browser&&!GetEnvironmentVariableW(haptics::map_env,explicit_map,160))return result;
    instance=*out;
#define LOAD(name) next_get(instance,"xr" #name,reinterpret_cast<PFN_xrVoidFunction*>(&next_##name));
    XR_FUNCTIONS(LOAD)
#undef LOAD
    if(!mapping.data&&!mapping.open(false))return XR_SUCCESS;
    XrActionSetCreateInfo set{XR_TYPE_ACTION_SET_CREATE_INFO};strcpy_s(set.actionSetName,"nfsu2_haptics");strcpy_s(set.localizedActionSetName,"NFSU2 vibration");
    if(XR_FAILED(next_CreateActionSet(instance,&set,&action_set)))return XR_SUCCESS;
    next_StringToPath(instance,"/user/hand/left",&hands[0]);next_StringToPath(instance,"/user/hand/right",&hands[1]);
    next_StringToPath(instance,"/user/hand/left/output/haptic",&outputs[0]);next_StringToPath(instance,"/user/hand/right/output/haptic",&outputs[1]);
    XrActionCreateInfo a{XR_TYPE_ACTION_CREATE_INFO};a.actionType=XR_ACTION_TYPE_VIBRATION_OUTPUT;
    strcpy_s(a.actionName,"vibration");strcpy_s(a.localizedActionName,"Vibration");a.countSubactionPaths=2;a.subactionPaths=hands;
    if(XR_FAILED(next_CreateAction(action_set,&a,&action))){next_DestroyActionSet(action_set);action_set=XR_NULL_HANDLE;}
    else InterlockedExchange(&mapping.data->initialized,static_cast<LONG>(GetCurrentProcessId()));
    return XR_SUCCESS;
}
}
extern "C" __declspec(dllexport) XrResult XRAPI_CALL xrNegotiateLoaderApiLayerInterface(
    const XrNegotiateLoaderInfo* loader,const char* name,XrNegotiateApiLayerRequest* request) {
    if(!loader||!name||!request||std::strcmp(name,haptics::layer_name)||loader->minInterfaceVersion>1||loader->maxInterfaceVersion<1)return XR_ERROR_INITIALIZATION_FAILED;
    request->layerInterfaceVersion=1;request->layerApiVersion=XR_MAKE_VERSION(1,0,0);
    request->getInstanceProcAddr=get;request->createApiLayerInstance=create;return XR_SUCCESS;
}
