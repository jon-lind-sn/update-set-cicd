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
                }
            }
        }
    }
}
