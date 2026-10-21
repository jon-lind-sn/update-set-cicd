import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    bom_json: {
                        table: 'sys_module'
                        id: '975093a022e641e88954f7548cf157d4'
                    }
                    'hello-update-set-cicd-fix-script': {
                        table: 'sys_script_fix'
                        id: '68499c9802aa41989402e04a4e16622b'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '7764d67216734ccd819be46ea119e037'
                    }
                    'src_server_fix-scripts_hello-update-set-cicd_js': {
                        table: 'sys_module'
                        id: 'f6a405c2fafd4880b9e0afa11bdd509f'
                    }
                    'src_server_script-includes_UpdateSetCicdSample_js': {
                        table: 'sys_module'
                        id: '4e908e398a7e49bfa48b17ebac2acc8f'
                    }
                    'update-set-cicd-sample-script-include': {
                        table: 'sys_script_include'
                        id: '592f200e2329499588edf0208f702095'
                    }
                    'update-set-cicd-sample-ui-message': {
                        table: 'sys_ui_message'
                        id: 'e6a415811ea64713b9c44abed04ea1e6'
                    }
                }
            }
        }
    }
}
