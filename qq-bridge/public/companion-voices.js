// Voice settings are rendered independently of the main dashboard.
// API credentials never enter this page. User-provided names use textContent.
async function renderVoiceSettings({panel,call,notice,make,button,card,isActive=()=>true}) {
  const catalog = await call('voice-catalog');
  if(!isActive())return;
  const available = catalog.voices.filter(voice => voice.enabled);
  const refresh = () => renderVoiceSettings({panel,call,notice,make,button,card,isActive});
  const voiceSelect = (label,current) => {
    const select = make('select');
    select.setAttribute('aria-label',label);
    for (const voice of available) {
      const option = make('option',voice.name);
      option.value = voice.id;
      option.selected = voice.id === current;
      select.append(option);
    }
    select.dataset.initialValue = select.value;
    return select;
  };
  panel.replaceChildren();
  panel.dataset.voiceRevision = JSON.stringify(catalog);
  const heading = make('div',undefined,'section-heading');
  heading.append(make('span','声音小衣橱','eyebrow'),make('h2','今天，想听哪种声音？'),make('p','新会话自动生成独立配置。音色按名字使用，修改后立即生效。'));
  panel.append(heading);

  const defaults = card('默认声音','没单独设置的私聊和群，会跟随这个声音。');
  const defaultSelect = voiceSelect('全局默认音色',catalog.globalDefaultId);
  const defaultRow = make('div',undefined,'form-row');
  defaultRow.append(defaultSelect,button('保存全局默认音色',async()=>{
    await call('voice-default',{id:defaultSelect.value}); await refresh(); notice('默认声音已更新，单独设置的会话保持自己的声音');
  }));
  defaults.append(defaultRow); panel.append(defaults);

  const library = make('section',undefined,'voice-library');
  library.append(make('h3','音色库'));
  for (const voice of catalog.voices) {
    const item = make('div',undefined,'voice-row');
    const rename = make('input'); rename.value = voice.name;rename.defaultValue=voice.name;
    rename.setAttribute('aria-label','重命名音色 '+voice.id);
    const actions = make('div',undefined,'voice-actions');
    actions.append(button('保存音色名称',async()=>{
      await call('voice-save',{...voice,name:rename.value}); await refresh(); notice('名字已保存，可以直接用新名字切换');
    }));
    if (voice.id !== 'default') actions.append(button(voice.enabled?'停用':'启用',async()=>{
      await call('voice-save',{...voice,enabled:!voice.enabled}); await refresh(); notice('音色状态已保存');
    }));
    item.append(make('span',voice.enabled?'● 可用':'○ 停用','voice-badge'),rename,actions);
    library.append(item);
  }
  const add = make('details',undefined,'voice-add');
  add.open = catalog.voices.length === 1;
  add.append(make('summary','＋ 添加已合成的音色'));
  const fields = make('div',undefined,'form-row');
  const name = make('input'); name.placeholder = '起个名字，如：俏皮小鲸鱼'; name.setAttribute('aria-label','新音色名称');
  const speaker = make('input'); speaker.placeholder = '火山平台音色 ID，通常 S_ 开头'; speaker.setAttribute('aria-label','新音色ID');
  fields.append(name,speaker,button('保存新音色',async()=>{
    await call('voice-save',{name:name.value,speaker:speaker.value}); await refresh(); notice('新音色已加入声音小衣橱');
  }));
  add.append(make('p','只填名称和音色 ID，继续使用原来的本地 API 凭据。'),fields);
  library.append(add); panel.append(library);

  const profiles = make('section',undefined,'voice-profiles');
  profiles.append(make('h3','每个人、每个群，都有自己的声音'),make('p','下面的配置由新会话自动建立。选择默认声音，只影响这一行。'));
  for (const profile of catalog.profiles) {
    const row = make('div',undefined,'voice-profile-row');
    const label = make('div'); label.append(make('strong',profile.label),make('small',(profile.key.startsWith('group:')?'群号 ':'QQ ')+profile.key.split(':')[1]+' · 当前：'+profile.voice));
    const select = voiceSelect('音色选择 '+profile.key,profile.defaultId);
    row.append(label,select,button('保存会话默认音色',async()=>{
      await call('voice-assign',{target:profile.key,id:select.value}); await refresh(); notice(profile.label+' 的默认声音已保存');
    }));
    if(profile.delivery){const labels={'sent':'最近语音已送达QQ','uncertain':'最近语音送达未确认，请核对QQ，勿重复发送','sending':'正在发送到QQ','generating':'正在合成语音','generation-failed':'合成失败，未发送到QQ'};label.append(make('small',labels[profile.delivery.status]||profile.delivery.status));}
    profiles.append(row);
  }
  panel.append(profiles);
  const help = make('aside',undefined,'voice-help');
  help.append(make('strong','说一句就好'),make('p','用俏皮小鲸鱼音色说管理员晚安'),make('small','临时用这个声音朗读一句，不改默认。持续切换：/切换音色 名字；恢复：/切换音色 默认。'));
  panel.append(help);
}

// New conversations and renamed voices appear automatically. Preserve unfinished forms.
async function refreshVoiceSettingsIfChanged({panel,call,refresh,isActive}) {
  if(!isActive()||panel.contains(document.activeElement)&&document.activeElement.matches('input,select,textarea'))return;
  if([...panel.querySelectorAll('input')].some(input=>input.value!==input.defaultValue))return;
  if([...panel.querySelectorAll('select')].some(select=>select.value!==select.dataset.initialValue))return;
  const catalog=await call('voice-catalog');
  if(isActive()&&JSON.stringify(catalog)!==panel.dataset.voiceRevision)await refresh();
}
