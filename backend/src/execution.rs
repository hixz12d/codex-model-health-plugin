use crate::invalid;
use gateway_plugin_sdk::PluginFault;
use std::{collections::HashSet, sync::Mutex};

// 实际上游调用期间持有账号租约；不同任务/页面也不能重复调用同一账号。
#[derive(Default)]
pub(crate) struct Accounts(Mutex<HashSet<String>>);

impl Accounts {
    pub fn busy(&self, account: &str) -> bool {
        self.0
            .lock()
            .expect("account lease mutex poisoned")
            .contains(account)
    }

    pub fn acquire(&self, account: &str) -> Result<Lease<'_>, PluginFault> {
        let mut active = self.0.lock().expect("account lease mutex poisoned");
        if !active.insert(account.to_owned()) {
            return Err(invalid("该账号已有检测请求正在执行，请等待当前题完成"));
        }
        Ok(Lease {
            accounts: self,
            account: account.to_owned(),
        })
    }
}

pub(crate) struct Lease<'a> {
    accounts: &'a Accounts,
    account: String,
}

impl Drop for Lease<'_> {
    fn drop(&mut self) {
        self.accounts
            .0
            .lock()
            .expect("account lease mutex poisoned")
            .remove(&self.account);
    }
}
