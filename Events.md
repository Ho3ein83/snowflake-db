## Application events
|     Event Name     | Description | Parameters |
|:------------------:|-------------|------------|
|   config_loaded    |             |            |
|   config_created   |             |            |
| app_config_loaded  |             |            |
| app_config_created |             |            |
|    before_start    |             |            |
|       start        |             |            |
|    before_stop     |             |            |
|        stop        |             |            |
|   before_restart   |             |            |
|      restart       |             |            |
|  request_restart   |             |            |
|  before_core_init  |             |            |
|  after_core_init   |             |            |

## Backup events
|     Event Name     | Description | Parameters |
|:------------------:|-------------|------------|
|   backup_skipped   |             |            |
|    backup_done     |             |            |
|   before_backup    |             |            |
|    backup_start    |             |            |

## Snapshot events
|      Event Name       | Description | Parameters |
|:---------------------:|-------------|------------|
|    before_snapshot    |             |            |
|       snapshot        |             |            |
| before_backup_restore |             |            |
| backup_restore_failed |             |            |
|    backup_restored    |             |            |

## CLI events
|       Event Name        | Description | Parameters |
|:-----------------------:|-------------|------------|
| cli_server_before_init  |             |            |
|  cli_server_connection  |             |            |
| cli_server_after_listen |             |            |

## Database events
|       Event Name       | Description | Parameters |
|:----------------------:|-------------|------------|
| before_database_reload |             |            |
| after_database_reload  |             |            |
|     before_db_load     |             |            |
|        db_load         |             |            |
|   before_meids_init    |             |            |
|    after_meids_init    |             |            |
|     before_db_read     |             |            |
|     after_db_read      |             |            |
| before_db_workers_init |             |            |
|    db_workers_init     |             |            |
|        truncate        |             |            |
|      truncate_all      |             |            |

## System events
|     Event Name     | Description | Parameters |
|:------------------:|-------------|------------|
| before_memory_init |             |            |
| after_memory_init  |             |            |
| before_core_start  |             |            |
|  after_core_start  |             |            |
| cypher_initialized |             |            |

## Workers events
|     Event Name     | Description | Parameters |
|:------------------:|-------------|------------|
| worker_aol_stopped |             |            |
|  workers_stopped   |             |            |

## Server events
|      Event Name      | Description | Parameters |
|:--------------------:|-------------|------------|
| socket_origin_reject |             |            |
| socket_login_attempt |             |            |
| socket_token_reject  |             |            |
| socket_origin_accept |             |            |
|     server_start     |             |            |
|     server_stop      |             |            |
|    http_app_init     |             |            |

## CLI events
|         Event Name          | Description | Parameters |
|:---------------------------:|-------------|------------|
|  cli_server_login_attempt   |             |            |
| cli_server_shell_authorized |             |            |
| cli_server_connection_data  |             |            |
|  cli_server_connection_end  |             |            |
| cli_server_connection_error |             |            |