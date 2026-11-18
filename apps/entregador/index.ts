import { registerRootComponent } from 'expo';
// Registra a tarefa de localização antes de tudo: o Android pode acordá-la com o app fechado.
import './src/localizacao';
import { App } from './src/App';

registerRootComponent(App);
